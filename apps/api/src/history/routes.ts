/**
 * Counter history reads: per-port rates over 1h … 3y. Fresh ranges read
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

const TrafficQuery = z.object({
  range: z.enum(HISTORY_RANGES).default('24h'),
  metric: z.enum(HISTORY_METRICS).default('bytes'),
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

/**
 * Shared preamble for counter reads: session, switch, and the same grant a
 * live `GET /interface` needs. True means a problem was already sent (a
 * boolean, not the reply: replies are thenables and `await` would unwrap them).
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
  const sw = await getSwitch(id);
  if (!sw) {
    problem(reply, 404, 'Not Found', `no switch ${id}`, request.url);
    return true;
  }
  const roles = await getUserRoles(who.sub);
  if (!mayAccessSwitch(roles, sw.groups)) {
    problem(reply, 403, 'Forbidden', `no role covers switch ${id}`, request.url);
    return true;
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
    problem(reply, 403, 'Forbidden', 'not granted by any role', request.url);
    return true;
  }
  return false;
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
    // Explicit bounds override the preset (custom ranges, comparisons).
    // Capped at 3 years + a day so one request can never scan the archive.
    const MAX_SPAN_MS = rangeSeconds('3y') + 86400_000;
    let since = new Date(Date.now() - rangeSeconds(range) * 1000);
    let until = new Date();
    if (parsed.data.from && parsed.data.to) {
      since = new Date(parsed.data.from);
      until = new Date(parsed.data.to);
      if (!(since < until) || until.getTime() - since.getTime() > MAX_SPAN_MS) {
        return problem(reply, 400, 'Bad Request', 'from/to invalid or span over 3 years', request.url);
      }
    }
    // Raw rows cover the retention window; anything older lives in hourly
    // buckets. Long spans and windows wholly past retention read buckets; a
    // window straddling the cutoff stitches buckets onto raw rows.
    const cutoff = new Date(Date.now() - RAW_RETENTION_DAYS * 86400_000);
    const long = until.getTime() - since.getTime() > RAW_RETENTION_DAYS * 86400_000;
    const points =
      long || until <= cutoff
        ? await hourlyPoints(id, iface, since, until, colA, colB)
        : since < cutoff
          ? [
              ...(await hourlyPoints(id, iface, since, cutoff, colA, colB)),
              ...(await rawPoints(id, iface, cutoff, until, colA, colB)),
            ]
          : await rawPoints(id, iface, since, until, colA, colB);
    return { range, metric, points, earliest: await earliestSample(id, iface) };
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
    return { samples, earliest: await earliestSample(id, iface) };
  });

  // Hours that can draw a rate (raw hours need two readings; hourly buckets
  // are deltas already), merged into spans so pickers can skip the gaps.
  app.get('/api/v1/switches/:id/interfaces/:iface/coverage', async (request, reply) => {
    const { id, iface } = request.params as { id: string; iface: string };
    if (await denyCounterRead(request, reply, cfg, id)) return reply;
    const { rows } = await db().query<{ h: Date }>(
      `SELECT h FROM (
         SELECT date_trunc('hour', ts) AS h FROM interface_samples
         WHERE switch_id = $1 AND iface = $2 GROUP BY 1 HAVING count(*) >= 2
         UNION
         SELECT hour FROM interface_samples_hourly WHERE switch_id = $1 AND iface = $2
       ) x ORDER BY h`,
      [id, iface],
    );
    return { spans: mergeHours(rows.map((r) => new Date(r.h).getTime())) };
  });

  app.get('/api/v1/switches/:id/traffic', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (await denyCounterRead(request, reply, cfg, id)) return reply;
    const parsed = TrafficQuery.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'range/metric invalid', request.url);
    const { range, metric } = parsed.data;
    const [colA, colB] = COLUMNS[metric];
    const since = new Date(Date.now() - rangeSeconds(range) * 1000);
    const useHourly = rangeSeconds(range) > 7 * 86400;
    const points = useHourly
      ? await hourlyTraffic(id, since, colA, colB)
      : await rawTraffic(id, since, colA, colB);
    return { range, metric, points };
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

/** When this port's history begins (raw or hourly), so the UI can say why older windows are empty. */
async function earliestSample(switchId: string, iface: string): Promise<string | null> {
  const { rows } = await db().query<{ t: Date | null }>(
    `SELECT LEAST(
       (SELECT min(ts) FROM interface_samples WHERE switch_id = $1 AND iface = $2),
       (SELECT min(hour) FROM interface_samples_hourly WHERE switch_id = $1 AND iface = $2)
     ) AS t`,
    [switchId, iface],
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
 * Switch-wide traffic: per-tick deltas summed across interfaces, then rated.
 * Raw ticks share one timestamp per switch poll, so grouping by ts works;
 * hourly buckets sum cleanly. Reset-aware per interface before summing.
 */
async function rawTraffic(
  switchId: string,
  since: Date,
  colA: string,
  colB: string,
): Promise<HistoryPoint[]> {
  const { rows } = await db().query<{ ts: Date; a: string; b: string }>(
    `WITH d AS (
       SELECT ts,
         ${colA} AS ca, LAG(${colA}) OVER (PARTITION BY iface ORDER BY ts) AS pa,
         ${colB} AS cb, LAG(${colB}) OVER (PARTITION BY iface ORDER BY ts) AS pb
       FROM interface_samples WHERE switch_id = $1 AND ts >= $2
     )
     SELECT ts,
       SUM(CASE WHEN pa IS NULL THEN 0 WHEN ca >= pa THEN ca - pa ELSE ca END) AS a,
       SUM(CASE WHEN pb IS NULL THEN 0 WHEN cb >= pb THEN cb - pb ELSE cb END) AS b
     FROM d GROUP BY ts ORDER BY ts`,
    [switchId, since],
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
  if (pts.length <= MAX_POINTS) return pts;
  const stride = Math.ceil(pts.length / MAX_POINTS);
  return pts.filter((_, i) => i % stride === 0);
}

async function hourlyTraffic(
  switchId: string,
  since: Date,
  colA: string,
  colB: string,
): Promise<HistoryPoint[]> {
  const { rows } = await db().query<{ hour: Date; a: string; b: string }>(
    `SELECT hour, SUM(${colA}) AS a, SUM(${colB}) AS b FROM interface_samples_hourly
     WHERE switch_id = $1 AND hour >= $2 GROUP BY hour ORDER BY hour`,
    [switchId, since],
  );
  const pts: HistoryPoint[] = rows.map((r) => ({
    t: new Date(r.hour).toISOString(),
    in: Number(r.a) / 3600,
    out: Number(r.b) / 3600,
  }));
  if (pts.length <= MAX_POINTS) return pts;
  const stride = Math.ceil(pts.length / MAX_POINTS);
  return pts.filter((_, i) => i % stride === 0);
}
