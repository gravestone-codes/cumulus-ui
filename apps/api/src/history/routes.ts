/**
 * Counter history reads: per-port rates over 1h … 3y. Fresh ranges read
 * raw 60s rows, older ones read hourly buckets; both answer per-second
 * rates so graphs render one series shape. Same read grants as live
 * queries (GET /interface), audited the same way (denials only).
 */
import type { FastifyInstance } from 'fastify';
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
  rangeSeconds,
  type HistoryMetric,
} from './sampler.js';

const Query = z.object({
  range: z.enum(HISTORY_RANGES).default('24h'),
  metric: z.enum(HISTORY_METRICS).default('bytes'),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

const COLUMNS: Record<HistoryMetric, [string, string]> = {
  bytes: ['in_bytes', 'out_bytes'],
  packets: ['in_pkts', 'out_pkts'],
  drops: ['drops', 'drops'],
  errors: ['errors', 'errors'],
};

const MAX_POINTS = 360;

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

export async function historyRoutes(app: FastifyInstance, deps: { cfg: AuthConfig }): Promise<void> {
  const { cfg } = deps;

  app.get('/api/v1/switches/:id/interfaces/:iface/history', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id, iface } = request.params as { id: string; iface: string };
    const parsed = Query.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'range/metric invalid', request.url);
    const sw = await getSwitch(id);
    if (!sw) return problem(reply, 404, 'Not Found', `no switch ${id}`, request.url);
    const roles = await getUserRoles(who.sub);
    const roleIds = roles.map((r) => r.id);
    if (!mayAccessSwitch(roles, sw.groups)) {
      return problem(reply, 403, 'Forbidden', `no role covers switch ${id}`, request.url);
    }
    if (!gateCheck(roles, { method: 'GET', path: '/interface', switchGroups: sw.groups })) {
      await audit({
        userSub: who.sub,
        username: who.username,
        roles: roleIds,
        switchId: id,
        method: 'GET',
        path: request.url,
      });
      return problem(reply, 403, 'Forbidden', 'not granted by any role', request.url);
    }
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
    // Raw rows cover the last 7 days; anything older lives in hourly buckets.
    const useHourly = until.getTime() - since.getTime() > 7 * 86400_000;
    const points = useHourly
      ? await hourlyPoints(id, iface, since, until, colA, colB)
      : await rawPoints(id, iface, since, until, colA, colB);
    return { range, metric, points };
  });
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
     WHERE switch_id = $1 AND iface = $2 AND hour >= $3 AND hour <= $4 ORDER BY hour`,
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
