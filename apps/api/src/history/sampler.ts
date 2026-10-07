/**
 * Counter history sampler (per-port trends for years, not minutes).
 * Every 60s each trusted switch with a stored credential gets one collection
 * read; per-interface counters land as raw rows (7d retention). A rollup
 * compacts anything older into hourly buckets kept indefinitely (>= 3y).
 *
 * Credentials: the sampler borrows the most recently stored credential's
 * user per switch and rides that user's cached token (minting only when
 * missing or dead). No new secrets, no user interaction. Single-instance
 * safe via advisory lock; multi-instance deployments elect one sampler per tick.
 */
import { db } from '../db.js';
import { withSwitchToken } from '../nvue/clients.js';

const SAMPLE_EVERY_MS = 60_000;
/** Raw 60s rows live this long; older history exists only as hourly buckets. */
export const RAW_RETENTION_DAYS = 7;

export const HISTORY_METRICS = ['bytes', 'packets', 'drops', 'errors'] as const;
export type HistoryMetric = (typeof HISTORY_METRICS)[number];

export const HISTORY_RANGES = ['1h', '24h', '7d', '30d', '1y', '3y'] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

/** Seconds covered by a range. */
export function rangeSeconds(range: HistoryRange): number {
  switch (range) {
    case '1h':
      return 3600;
    case '24h':
      return 86400;
    case '7d':
      return 604800;
    case '30d':
      return 2592000;
    case '1y':
      return 31536000;
    case '3y':
      return 94608000;
  }
}

interface Counters {
  inB: number;
  outB: number;
  inP: number;
  outP: number;
  drops: number;
  errors: number;
}

/** Extract the counter set the history keeps from one interface object. */
export function extractCounters(obj: Record<string, unknown>): Counters {
  const at = (path: string): number => {
    let node: unknown = obj;
    for (const seg of path.split('/')) {
      if (typeof node !== 'object' || node === null) return 0;
      node = (node as Record<string, unknown>)[seg];
    }
    return typeof node === 'number' && Number.isFinite(node) ? node : 0;
  };
  return {
    inB: at('link/stats/in-bytes'),
    outB: at('link/stats/out-bytes'),
    inP: at('link/stats/in-pkts'),
    outP: at('link/stats/out-pkts'),
    drops: at('link/stats/in-drops') + at('link/stats/out-drops'),
    errors: at('link/stats/in-errors') + at('link/stats/out-errors'),
  };
}

/**
 * Delta between two cumulative readings. Counter reset/reboot (cur < prev)
 * counts the current value, never a negative spike.
 */
export function counterDelta(prev: number, cur: number): number {
  return cur >= prev ? cur - prev : cur;
}

/** One completed sampling tick across the fleet. Errors per switch never fail the tick. */
export async function sampleTick(credKey: string): Promise<{ switches: number; ifaces: number }> {
  const locked = await db().query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [
    'history-sample',
  ]);
  if (!locked.rows[0]?.ok) return { switches: 0, ifaces: 0 };
  try {
    const { rows: creds } = await db().query<{ user_sub: string; switch_id: string }>(
      `SELECT DISTINCT ON (switch_id) user_sub, switch_id FROM switch_credentials ORDER BY switch_id, updated_at DESC`,
    );
    let switches = 0;
    let ifaces = 0;
    for (const { user_sub, switch_id } of creds) {
      try {
        ifaces += await sampleSwitch(credKey, user_sub, switch_id);
        switches++;
      } catch {
        /* one dark switch never blocks the rest */
      }
    }
    return { switches, ifaces };
  } finally {
    await db().query('SELECT pg_advisory_unlock(hashtext($1))', ['history-sample']);
  }
}

/** Sample one switch's counters into raw rows; returns interfaces written. */
export async function sampleSwitch(credKey: string, userSub: string, switchId: string): Promise<number> {
  const { rows } = await db().query(`SELECT 1 FROM switches WHERE id = $1 AND enabled AND trust_verified`, [
    switchId,
  ]);
  if (rows.length === 0) return 0;
  // Reuse the user's cached token; minting every tick would replace the one
  // their own reads hold. A missing/dead token is minted from the sealed credential.
  const { data } = await withSwitchToken(userSub, switchId, { credKey }, (client, token) =>
    client.call({ path: '/interface', method: 'GET', rev: 'operational', token }),
  );
  if (typeof data !== 'object' || data === null) return 0;
  const now = new Date();
  let n = 0;
  for (const [iface, obj] of Object.entries(data as Record<string, unknown>)) {
    if (typeof obj !== 'object' || obj === null) continue;
    const c = extractCounters(obj as Record<string, unknown>);
    await db().query(
      `INSERT INTO interface_samples (switch_id, iface, ts, in_bytes, out_bytes, in_pkts, out_pkts, drops, errors)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING`,
      [switchId, iface, now, c.inB, c.outB, c.inP, c.outP, c.drops, c.errors],
    );
    n++;
  }
  return n;
}

/**
 * Compact raw rows older than the retention window into hourly buckets,
 * then delete them. Hours aggregate ordered samples; a counter going
 * backwards (reboot) counts its current value, never negative.
 */
export async function rollupTick(): Promise<{ hours: number; deleted: number }> {
  const locked = await db().query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [
    'history-rollup',
  ]);
  if (!locked.rows[0]?.ok) return { hours: 0, deleted: 0 };
  try {
    const cutoff = new Date(Date.now() - RAW_RETENTION_DAYS * 86400_000);
    const { rows: keys } = await db().query<{ switch_id: string; iface: string }>(
      `SELECT DISTINCT switch_id, iface FROM interface_samples WHERE ts < $1`,
      [cutoff],
    );
    let hours = 0;
    for (const { switch_id, iface } of keys) {
      // Per-hour deltas from ordered samples; a counter going backwards
      // (reboot) counts its current value, never negative.
      const { rows: buckets } = await db().query<{
        hour: Date;
        in_bytes: string;
        out_bytes: string;
        in_pkts: string;
        out_pkts: string;
        drops: string;
        errors: string;
        n: string;
      }>(
        `WITH ordered AS (
           SELECT ts,
             in_bytes, out_bytes, in_pkts, out_pkts, drops, errors,
             LAG(in_bytes) OVER w AS p_in_bytes, LAG(out_bytes) OVER w AS p_out_bytes,
             LAG(in_pkts) OVER w AS p_in_pkts, LAG(out_pkts) OVER w AS p_out_pkts,
             LAG(drops) OVER w AS p_drops, LAG(errors) OVER w AS p_errors
           FROM interface_samples WHERE switch_id = $1 AND iface = $2 AND ts < $3
           WINDOW w AS (ORDER BY ts)
         )
         SELECT date_trunc('hour', ts) AS hour,
           COALESCE(SUM(CASE WHEN in_bytes >= p_in_bytes THEN in_bytes - p_in_bytes ELSE in_bytes END), 0) AS in_bytes,
           COALESCE(SUM(CASE WHEN out_bytes >= p_out_bytes THEN out_bytes - p_out_bytes ELSE out_bytes END), 0) AS out_bytes,
           COALESCE(SUM(CASE WHEN in_pkts >= p_in_pkts THEN in_pkts - p_in_pkts ELSE in_pkts END), 0) AS in_pkts,
           COALESCE(SUM(CASE WHEN out_pkts >= p_out_pkts THEN out_pkts - p_out_pkts ELSE out_pkts END), 0) AS out_pkts,
           COALESCE(SUM(CASE WHEN drops >= p_drops THEN drops - p_drops ELSE drops END), 0) AS drops,
           COALESCE(SUM(CASE WHEN errors >= p_errors THEN errors - p_errors ELSE errors END), 0) AS errors,
           COUNT(*) AS n
         FROM ordered GROUP BY 1`,
        [switch_id, iface, cutoff],
      );
      for (const b of buckets) {
        await db().query(
          `INSERT INTO interface_samples_hourly
             (switch_id, iface, hour, in_bytes, out_bytes, in_pkts, out_pkts, drops, errors, samples)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (switch_id, iface, hour) DO UPDATE SET
             in_bytes = EXCLUDED.in_bytes, out_bytes = EXCLUDED.out_bytes,
             in_pkts = EXCLUDED.in_pkts, out_pkts = EXCLUDED.out_pkts,
             drops = EXCLUDED.drops, errors = EXCLUDED.errors, samples = EXCLUDED.samples`,
          [switch_id, iface, b.hour, b.in_bytes, b.out_bytes, b.in_pkts, b.out_pkts, b.drops, b.errors, b.n],
        );
        hours++;
      }
    }
    const deleted = await db().query('DELETE FROM interface_samples WHERE ts < $1', [cutoff]);
    return { hours, deleted: deleted.rowCount ?? 0 };
  } finally {
    await db().query('SELECT pg_advisory_unlock(hashtext($1))', ['history-rollup']);
  }
}

/** Start the sampler + rollup loops. Timers are unref'd; tests never start them. */
export function startHistoryJobs(credKey: string): void {
  const sample = () => {
    sampleTick(credKey).catch(() => undefined);
  };
  const rollup = () => {
    rollupTick().catch(() => undefined);
  };
  setTimeout(sample, 10_000).unref?.();
  setInterval(sample, SAMPLE_EVERY_MS).unref?.();
  setInterval(rollup, 60 * 60_000).unref?.();
}
