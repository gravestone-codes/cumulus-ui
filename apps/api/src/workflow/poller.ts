/**
 * Revision poller (roadmap 4.6, decision 6.7): one small GET per switch for
 * its applied revision ID, on the shortest poll interval of its groups
 * (default 30s, admin-adjustable per group). Nothing heavier is fetched here —
 * screens refetch full state only once the ID has moved and the user refreshes.
 *
 * Credentials: like the history sampler, borrows the most recently stored
 * credential's user per switch. Checks run inside the per-switch apply queue
 * so our own apply can never be mistaken for drift; a switch mid-apply is
 * skipped this tick. Single-instance safe via advisory lock.
 */
import { db } from '../db.js';
import { withSwitchToken } from '../nvue/clients.js';
import { getAppliedRevision } from '../nvue/revisions.js';
import { applyBusy, enqueueApply } from './apply.js';
import { DEFAULT_POLL_SEC, observeRevision, type Drift } from './drift.js';

const TICK_MS = 5_000;

/** Switches due a check now: enabled, trusted, credentialed, and past their group interval. */
async function dueSwitches(): Promise<Array<{ switchId: string; userSub: string }>> {
  const { rows } = await db().query<{ switch_id: string; user_sub: string }>(
    `WITH every AS (
       SELECT s.id, COALESCE(MIN(g.poll_interval_sec), $1) AS secs
       FROM switches s
       LEFT JOIN switch_groups sg ON sg.switch_id = s.id
       LEFT JOIN groups g ON g.id = sg.group_id
       WHERE s.enabled AND s.trust_verified
       GROUP BY s.id
     ), cred AS (
       SELECT DISTINCT ON (switch_id) switch_id, user_sub FROM switch_credentials
       ORDER BY switch_id, updated_at DESC
     )
     SELECT e.id AS switch_id, c.user_sub FROM every e
     JOIN cred c ON c.switch_id = e.id
     LEFT JOIN switch_revisions r ON r.switch_id = e.id
     WHERE r.checked_at IS NULL OR r.checked_at <= now() - make_interval(secs => e.secs)`,
    [DEFAULT_POLL_SEC],
  );
  return rows.map((r) => ({ switchId: r.switch_id, userSub: r.user_sub }));
}

/** Check one switch's applied revision; returns the drift when it moved outside the app. */
export async function checkSwitch(credKey: string, userSub: string, switchId: string): Promise<Drift | null> {
  if (applyBusy(switchId)) return null;
  return enqueueApply(switchId, async () => {
    const rev = await withSwitchToken(userSub, switchId, { credKey }, (client, token) =>
      getAppliedRevision(client, token),
    );
    return observeRevision(switchId, rev);
  });
}

/** One poll tick across the fleet. A dark switch never blocks the rest. */
export async function pollTick(credKey: string): Promise<{ checked: number; drifted: string[] }> {
  // Session-level lock: lock and unlock must share one connection.
  const conn = await db().connect();
  try {
    const locked = await conn.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [
      'revision-poll',
    ]);
    if (!locked.rows[0]?.ok) return { checked: 0, drifted: [] };
    try {
      const due = await dueSwitches();
      const results = await Promise.all(
        due.map(({ switchId, userSub }) =>
          checkSwitch(credKey, userSub, switchId).catch(async () => {
            // Unreachable: wait out the interval instead of retrying every tick.
            await db().query('UPDATE switch_revisions SET checked_at = now() WHERE switch_id = $1', [
              switchId,
            ]);
            return null;
          }),
        ),
      );
      return { checked: due.length, drifted: results.flatMap((d) => (d ? [d.switchId] : [])) };
    } finally {
      await conn.query('SELECT pg_advisory_unlock(hashtext($1))', ['revision-poll']);
    }
  } finally {
    conn.release();
  }
}

/** Start the poll loop. Timer is unref'd; tests never start it. */
export function startRevisionPoller(credKey: string): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    pollTick(credKey)
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  }, TICK_MS).unref?.();
}
