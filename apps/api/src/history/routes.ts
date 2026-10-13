/**
 * Counter history reads: per-port and switch-wide rates over 1h … 3y. Fresh ranges read
 * raw 60s rows, older ones read hourly buckets; both answer per-second
 * rates so graphs render one series shape. Recent raw readings also seed
 * the live graph so it draws on arrival. Same read grants as live
 * queries (GET /interface), audited the same way (denials only).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { resolveCaller } from '../auth/caller.js';
import { gateCheck, getUserRoles, mayAccessSwitch } from '../rbac/store.js';
import { audit } from '../audit/store.js';
import { getSwitch } from '../inventory/store.js';
import { db } from '../db.js';
import {
  counterDelta,
  HISTORY_METRICS,
  HISTORY_RANGES,
  RAW_RETENTION_DAYS,
  rangeSeconds,
  type HistoryMetric,
} from './sampler.js';

const Query = z.object({
  range: z.enum(HISTORY_RANGES).default('24h'),
  metric: z.enum(HISTORY_METRICS).default('bytes'),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

/** Switch-wide reads over a set of switches: `ids=a,b,c` (deduplicated, 1–128). */
const FleetQuery = Query.extend({
  ids: z
    .string()
    .max(8192)
    .transform((v) => [...new Set(v.split(',').filter(Boolean))])
    .refine((a) => a.length >= 1 && a.length <= 128),
});

const SamplesQuery = z.object({
  minutes: z.coerce.number().int().min(1).max(60).default(15),
});

const COLUMNS: Record<HistoryMetric, [string, string]> = {
  bytes: ['in_bytes', 'out_bytes'],
  packets: ['in_pkts', 'out_pkts'],
  drops: ['drops', 'drops'],
  errors: ['errors', 'errors'],
};

const MAX_POINTS = 360;

/** One raw cumulative reading; the live graph seeds from these. */
export interface CounterSample {
  t: number;
  inB: number;
  outB: number;
  inP: number;
  outP: number;
  dr: number;
  er: number;
}

export interface HistoryPoint {
  t: string;
  in: number;
  out: number;
}

/** Rates from ordered cumulative readings (reset-aware); stride-capped. */
export function toRates(
  rows: Array<{ ts: Date | string; a: string | number; b: string | number }>,
): HistoryPoint[] {
  const pts: HistoryPoint[] = [];
  for (let i = 1; i < rows.length; i++) {
    const t = new Date(rows[i]?.ts ?? 0).getTime();
    const t0 = new Date(rows[i - 1]?.ts ?? 0).getTime();
    const dt = (t - t0) / 1000;
    if (!(dt > 0)) continue;
    pts.push({
      t: new Date(t).toISOString(),
      in: counterDelta(Number(rows[i - 1]?.a ?? 0), Number(rows[i]?.a ?? 0)) / dt,
      out: counterDelta(Number(rows[i - 1]?.b ?? 0), Number(rows[i]?.b ?? 0)) / dt,
    });
  }
  if (pts.length <= MAX_POINTS) return pts;
  const stride = Math.ceil(pts.length / MAX_POINTS);
  return pts.filter((_, i) => i % stride === 0);
}

type Caller = NonNullable<Awaited<ReturnType<typeof resolveCaller>>>;
type Denial = { status: 403 | 404; title: string; detail: string };

/**
 * Whether `who` may read one switch's counters: the switch exists and the
 * same grant a live `GET /interface` needs. Gate denials are audited.
 */
async function counterReadDenial(request: FastifyRequest, who: Caller, id: string): Promise<Denial | null> {
  const sw = await getSwitch(id);
  if (!sw) return { status: 404, title: 'Not Found', detail: `no switch ${id}` };
  const roles = await getUserRoles(who.sub);
  if (!mayAccessSwitch(roles, sw.groups)) {
    return { status: 403, title: 'Forbidden', detail: `no role covers switch ${id}` };
  }
  if (!gateCheck(roles, { method: 'GET', path: '/interface', switchGroups: sw.groups })) {
    await audit({
      userSub: who.sub,
      username: who.username,
      roles: roles.map((r) => r.id),
      switchId: id,
      method: 'GET',
      path: request.url,
    });
    return { status: 403, title: 'Forbidden', detail: 'not granted by any role' };
  }
  return null;
}

/**
 * Shared preamble for one switch's counter reads: session, then
 * counterReadDenial. True means a problem was already sent (a boolean, not
 * the reply: replies are thenables and `await` would unwrap them).
 */
async function denyCounterRead(
  request: FastifyRequest,
  reply: FastifyReply,
  cfg: AuthConfig,
  id: string,
): Promise<boolean> {
  const who = await resolveCaller(request, cfg);
  if (!who) {
    problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    return true;
  }
  const denial = await counterReadDenial(request, who, id);
  if (denial) {
    problem(reply, denial.status, denial.title, denial.detail, request.url);
    return true;
  }
  return false;
}

/**
 * Many-switch preamble: session, then each switch vetted on its own. Switches
 * the caller cannot read are skipped (and named), not fatal, so one
 * uncovered member never blanks a fleet graph. Null means 401 was sent.
 */
async function readableSwitches(
  request: FastifyRequest,
  reply: FastifyReply,
  cfg: AuthConfig,
  ids: string[],
): Promise<{ allowed: string[]; skipped: string[] } | null> {
  const who = await resolveCaller(request, cfg);
  if (!who) {
    problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    return null;
  }
  const allowed: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) ((await counterReadDenial(request, who, id)) ? skipped : allowed).push(id);
  return { allowed, skipped };
}

/**
 * Sum switch series on a shared minute grid: each switch averages within a
 * minute, then switches add. Pollers drift, so a switch missing one minute
 * holds its previous minute rather than dipping the total.
 */
export function sumAligned(series: HistoryPoint[][]): HistoryPoint[] {
  const MIN = 60_000;
  const perSwitch = series.map((pts) => {
    const m = new Map<number, { in: number; out: number; n: number }>();
    for (const p of pts) {
      const k = Math.floor(Date.parse(p.t) / MIN) * MIN;
      const c = m.get(k) ?? { in: 0, out: 0, n: 0 };
      c.in += p.in;
      c.out += p.out;
      c.n += 1;
      m.set(k, c);
    }
    return m;
  });
  const grid = [...new Set(perSwitch.flatMap((m) => [...m.keys()]))].sort((a, b) => a - b);
  return grid.map((k) => {
    let inSum = 0;
    let outSum = 0;
    for (const m of perSwitch) {
      const c = m.get(k) ?? m.get(k - MIN);
      if (!c) continue;
      inSum += c.in / c.n;
      outSum += c.out / c.n;
    }
    return { t: new Date(k).toISOString(), in: inSum, out: outSum };
  });
}

/** Every Nth point once a series passes MAX_POINTS (graphs never need more). */
function capPoints(pts: HistoryPoint[]): HistoryPoint[] {
  if (pts.length <= MAX_POINTS) return pts;
  const stride = Math.ceil(pts.length / MAX_POINTS);
  return pts.filter((_, i) => i % stride === 0);
}

export async function historyRoutes(app: FastifyInstance, deps: { cfg: AuthConfig }): Promise<void> {
  const { cfg } = deps;

  app.get('/api/v1/switches/:id/interfaces/:iface/history', async (request, reply) => {
    const { id, iface } = request.params as { id: string; iface: string };
    if (await denyCounterRead(request, reply, cfg, id)) return reply;
    const parsed = Query.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'range/metric invalid', request.url);
    const { range, metric } = parsed.data;
    const [colA, colB] = COLUMNS[metric];
    const w = windowOf(parsed.data);
    if (!w) return problem(reply, 400, 'Bad Request', 'from/to invalid or span over 3 years', request.url);
    const points = await stitched(
      w,
      (a, b) => hourlyPoints(id, iface, a, b, colA, colB),
      (a, b) => rawPoints(id, iface, a, b, colA, colB),
    );
    return { range, metric, points, earliest: await earliestSample([id], iface) };
  });

  app.get('/api/v1/switches/:id/interfaces/:iface/samples', async (request, reply) => {
    const { id, iface } = request.params as { id: string; iface: string };
    if (await denyCounterRead(request, reply, cfg, id)) return reply;
    const parsed = SamplesQuery.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'minutes must be 1–60', request.url);
    const since = new Date(Date.now() - parsed.data.minutes * 60_000);
    const { rows } = await db().query<{
      ts: Date;
      in_bytes: string;
      out_bytes: string;
      in_pkts: string;
      out_pkts: string;
      drops: string;
      errors: string;
    }>(
      `SELECT ts, in_bytes, out_bytes, in_pkts, out_pkts, drops, errors FROM interface_samples
       WHERE switch_id = $1 AND iface = $2 AND ts >= $3 ORDER BY ts`,
      [id, iface, since],
    );
    const samples: CounterSample[] = rows.map((r) => ({
      t: new Date(r.ts).getTime(),
      inB: Number(r.in_bytes),
      outB: Number(r.out_bytes),
      inP: Number(r.in_pkts),
      outP: Number(r.out_pkts),
      dr: Number(r.drops),
      er: Number(r.errors),
    }));
    return { samples, earliest: await earliestSample([id], iface) };
  });

  app.get('/api/v1/switches/:id/interfaces/:iface/coverage', async (request, reply) => {
    const { id, iface } = request.params as { id: string; iface: string };
    if (await denyCounterRead(request, reply, cfg, id)) return reply;
    return { spans: await coverage([id], iface) };
  });

  // Switch-wide traffic for one or many switches (a switch home, a group, the
  // fleet): each switch's ports summed, then switches summed on a minute grid.
  app.get('/api/v1/traffic', async (request, reply) => {
    const parsed = FleetQuery.safeParse(request.query);
    if (!parsed.success) {
      return problem(reply, 400, 'Bad Request', 'ids (1–128) or range/metric invalid', request.url);
    }
    const scope = await readableSwitches(request, reply, cfg, parsed.data.ids);
    if (!scope) return reply;
    const { range, metric } = parsed.data;
    const [colA, colB] = COLUMNS[metric];
    const w = windowOf(parsed.data);
    if (!w) return problem(reply, 400, 'Bad Request', 'from/to invalid or span over 3 years', request.url);
    const series = await Promise.all(
      scope.allowed.map((id) =>
        stitched(
          w,
          (a, b) => hourlyTraffic(id, a, b, colA, colB),
          (a, b) => rawTraffic(id, a, b, colA, colB),
        ),
      ),
    );
    return {
      range,
      metric,
      points: capPoints(sumAligned(series)),
      earliest: scope.allowed.length > 0 ? await earliestSample(scope.allowed) : null,
      skipped: scope.skipped,
    };
  });

  app.get('/api/v1/traffic/coverage', async (request, reply) => {
    const parsed = FleetQuery.pick({ ids: true }).safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'ids (1–128) invalid', request.url);
    const scope = await readableSwitches(request, reply, cfg, parsed.data.ids);
    if (!scope) return reply;
    return { spans: scope.allowed.length > 0 ? await coverage(scope.allowed) : [], skipped: scope.skipped };
  });
}

/** Sorted hour starts → contiguous [from, to) spans (ISO). */
export function mergeHours(hours: number[]): Array<{ from: string; to: string }> {
  const spans: Array<{ from: number; to: number }> = [];
  for (const h of hours) {
    const last = spans[spans.length - 1];
    if (last && h <= last.to) last.to = Math.max(last.to, h + 3600_000);
    else spans.push({ from: h, to: h + 3600_000 });
  }
  return spans.map((s) => ({ from: new Date(s.from).toISOString(), to: new Date(s.to).toISOString() }));
}

/**
 * The window a history read covers: the preset back from now, or explicit
 * bounds (custom ranges, comparisons) capped at 3 years + a day so one
 * request can never scan the archive. Null when the bounds are invalid.
 */
function windowOf(q: z.infer<typeof Query>): { since: Date; until: Date } | null {
  if (!(q.from && q.to))
    return { since: new Date(Date.now() - rangeSeconds(q.range) * 1000), until: new Date() };
  const since = new Date(q.from);
  const until = new Date(q.to);
  const MAX_SPAN_MS = rangeSeconds('3y') + 86400_000;
  return since < until && until.getTime() - since.getTime() <= MAX_SPAN_MS ? { since, until } : null;
}

/**
 * Raw rows cover the retention window; anything older lives in hourly
 * buckets. Long spans and windows wholly past retention read buckets; a
 * window straddling the cutoff stitches buckets onto raw rows.
 */
async function stitched(
  { since, until }: { since: Date; until: Date },
  hourly: (a: Date, b: Date) => Promise<HistoryPoint[]>,
  raw: (a: Date, b: Date) => Promise<HistoryPoint[]>,
): Promise<HistoryPoint[]> {
  const cutoff = new Date(Date.now() - RAW_RETENTION_DAYS * 86400_000);
  const long = until.getTime() - since.getTime() > RAW_RETENTION_DAYS * 86400_000;
  if (long || until <= cutoff) return hourly(since, until);
  if (since < cutoff) return [...(await hourly(since, cutoff)), ...(await raw(cutoff, until))];
  return raw(since, until);
}

/** Port filter for switch-wide reads (no iface) vs one port. */
const ifaceClause = (iface?: string) => (iface === undefined ? '' : ' AND iface = $2');
const ifaceArgs = (switchIds: string[], iface?: string) =>
  iface === undefined ? [switchIds] : [switchIds, iface];

/**
 * Hours that can draw a rate (raw hours need two readings; hourly buckets
 * are deltas already), merged into spans so pickers can skip the gaps.
 */
async function coverage(switchIds: string[], iface?: string): Promise<Array<{ from: string; to: string }>> {
  const f = ifaceClause(iface);
  const { rows } = await db().query<{ h: Date }>(
    `SELECT h FROM (
       SELECT date_trunc('hour', ts) AS h FROM interface_samples
       WHERE switch_id = ANY($1)${f} GROUP BY switch_id, 1 HAVING count(DISTINCT ts) >= 2
       UNION
       SELECT hour FROM interface_samples_hourly WHERE switch_id = ANY($1)${f}
     ) x ORDER BY h`,
    ifaceArgs(switchIds, iface),
  );
  return mergeHours(rows.map((r) => new Date(r.h).getTime()));
}

/** When history begins (raw or hourly) for a port, or any port of the switches without `iface`. */
async function earliestSample(switchIds: string[], iface?: string): Promise<string | null> {
  const f = ifaceClause(iface);
  const { rows } = await db().query<{ t: Date | null }>(
    `SELECT LEAST(
       (SELECT min(ts) FROM interface_samples WHERE switch_id = ANY($1)${f}),
       (SELECT min(hour) FROM interface_samples_hourly WHERE switch_id = ANY($1)${f})
     ) AS t`,
    ifaceArgs(switchIds, iface),
  );
  const t = rows[0]?.t;
  return t ? new Date(t).toISOString() : null;
}

async function rawPoints(
  switchId: string,
  iface: string,
  since: Date,
  until: Date,
  colA: string,
  colB: string,
): Promise<HistoryPoint[]> {
  const { rows } = await db().query<{ ts: Date; a: number; b: number }>(
    `SELECT ts, ${colA} AS a, ${colB} AS b FROM interface_samples
     WHERE switch_id = $1 AND iface = $2 AND ts >= $3 AND ts <= $4 ORDER BY ts`,
    [switchId, iface, since, until],
  );
  return toRates(rows);
}

async function hourlyPoints(
  switchId: string,
  iface: string,
  since: Date,
  until: Date,
  colA: string,
  colB: string,
): Promise<HistoryPoint[]> {
  const { rows } = await db().query<{ hour: Date; a: string; b: string }>(
    `SELECT hour, ${colA} AS a, ${colB} AS b FROM interface_samples_hourly
     WHERE switch_id = $1 AND iface = $2 AND hour >= date_trunc('hour', $3::timestamptz) AND hour < $4
     ORDER BY hour`,
    [switchId, iface, since, until],
  );
  // Hourly rows already hold deltas: rate per bucket, stride-capped.
  const pts: HistoryPoint[] = rows.map((r) => ({
    t: new Date(r.hour).toISOString(),
    in: Number(r.a) / 3600,
    out: Number(r.b) / 3600,
  }));
  if (pts.length <= MAX_POINTS) return pts;
  const stride = Math.ceil(pts.length / MAX_POINTS);
  return pts.filter((_, i) => i % stride === 0);
}

/**
 * Switch-wide traffic: per-tick deltas summed across interfaces, then rated
 * (uncapped: callers sum switches first, then cap).
 * Raw ticks share one timestamp per switch poll, so grouping by ts works;
 * hourly buckets sum cleanly. Reset-aware per interface before summing.
 */
async function rawTraffic(
  switchId: string,
  since: Date,
  until: Date,
  colA: string,
  colB: string,
): Promise<HistoryPoint[]> {
  const { rows } = await db().query<{ ts: Date; a: string; b: string }>(
    `WITH d AS (
       SELECT ts,
         ${colA} AS ca, LAG(${colA}) OVER (PARTITION BY iface ORDER BY ts) AS pa,
         ${colB} AS cb, LAG(${colB}) OVER (PARTITION BY iface ORDER BY ts) AS pb
       FROM interface_samples WHERE switch_id = $1 AND ts >= $2 AND ts <= $3
     )
     SELECT ts,
       SUM(CASE WHEN pa IS NULL THEN 0 WHEN ca >= pa THEN ca - pa ELSE ca END) AS a,
       SUM(CASE WHEN pb IS NULL THEN 0 WHEN cb >= pb THEN cb - pb ELSE cb END) AS b
     FROM d GROUP BY ts ORDER BY ts`,
    [switchId, since, until],
  );
  const pts: HistoryPoint[] = [];
  for (let i = 1; i < rows.length; i++) {
    const t = new Date(rows[i]?.ts ?? 0).getTime();
    const t0 = new Date(rows[i - 1]?.ts ?? 0).getTime();
    const dt = (t - t0) / 1000;
    if (!(dt > 0)) continue;
    pts.push({
      t: new Date(t).toISOString(),
      in: Number(rows[i]?.a ?? 0) / dt,
      out: Number(rows[i]?.b ?? 0) / dt,
    });
  }
  return pts;
}

async function hourlyTraffic(
  switchId: string,
  since: Date,
  until: Date,
  colA: string,
  colB: string,
): Promise<HistoryPoint[]> {
  const { rows } = await db().query<{ hour: Date; a: string; b: string }>(
    `SELECT hour, SUM(${colA}) AS a, SUM(${colB}) AS b FROM interface_samples_hourly
     WHERE switch_id = $1 AND hour >= date_trunc('hour', $2::timestamptz) AND hour < $3
     GROUP BY hour ORDER BY hour`,
    [switchId, since, until],
  );
  const pts: HistoryPoint[] = rows.map((r) => ({
    t: new Date(r.hour).toISOString(),
    in: Number(r.a) / 3600,
    out: Number(r.b) / 3600,
  }));
  return pts;
}
