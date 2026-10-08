/**
 * Out-of-band detection (roadmap 4.6, decision 6.7): a CLI or direct-API
 * writer is just another lane. We remember each switch's applied revision ID;
 * a move our ApplyPipeline made is recorded silently, any other move is drift
 * — logged, audited, and shown to every user until they refresh.
 */
import pino from 'pino';
import { db } from '../db.js';
import { audit } from '../audit/store.js';
import type { AppliedRevision } from '../nvue/revisions.js';

/** Default poll interval per group (seconds); admin-adjustable per group. */
export const DEFAULT_POLL_SEC = 30;

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' }).child({ action: 'drift' });

/** A switch's latest out-of-band move. */
export interface Drift {
  switchId: string;
  from: string;
  to: string;
  /** NVUE's attribution of the move (switch user + CLI/API), when reported. */
  by: { user: string | null; type: string | null; date: string | null } | null;
  detectedAt: string;
}

interface RevRow {
  applied_id: string;
  drift_at: Date | null;
  drift_from: string | null;
  drift_to: string | null;
  drift_by: Drift['by'];
}

/**
 * Record an observed applied revision. `ours` = our ApplyPipeline just moved
 * it. First sighting is a baseline. Callers serialize per switch (apply queue).
 * Returns the new drift when this observation is one.
 */
export async function observeRevision(
  switchId: string,
  rev: AppliedRevision,
  opts: { ours?: boolean; reqId?: string } = {},
): Promise<Drift | null> {
  const { rows } = await db().query<RevRow>('SELECT * FROM switch_revisions WHERE switch_id = $1', [
    switchId,
  ]);
  const prev = rows[0];
  if (!prev || prev.applied_id === rev.id || opts.ours) {
    await db().query(
      `INSERT INTO switch_revisions (switch_id, applied_id, checked_at) VALUES ($1, $2, now())
       ON CONFLICT (switch_id) DO UPDATE SET applied_id = $2, checked_at = now()`,
      [switchId, rev.id],
    );
    return null;
  }
  const by = { user: rev.user, type: rev.type, date: rev.date };
  const { rows: updated } = await db().query<{ drift_at: Date }>(
    `UPDATE switch_revisions SET applied_id = $2, checked_at = now(), drift_at = now(),
       drift_from = $3, drift_to = $2, drift_by = $4
     WHERE switch_id = $1 RETURNING drift_at`,
    [switchId, rev.id, prev.applied_id, JSON.stringify(by)],
  );
  const drift: Drift = {
    switchId,
    from: prev.applied_id,
    to: rev.id,
    by,
    detectedAt: (updated[0]?.drift_at ?? new Date()).toISOString(),
  };
  log.warn(
    {
      reqId: opts.reqId,
      switch: switchId,
      path: '/revision/applied',
      outcome: 'drift',
      from: drift.from,
      to: drift.to,
    },
    'switch changed outside the app',
  );
  await audit({
    userSub: 'system',
    username: 'system',
    roles: [],
    switchId,
    method: 'GET',
    path: '/revision/applied',
    before: { applied: drift.from },
    after: { applied: drift.to, by },
    rev: drift.to,
  });
  return drift;
}

/** The switch's latest drift, if any. */
export async function getDrift(switchId: string): Promise<Drift | null> {
  const { rows } = await db().query<RevRow>(
    'SELECT * FROM switch_revisions WHERE switch_id = $1 AND drift_at IS NOT NULL',
    [switchId],
  );
  const r = rows[0];
  return r ? toDrift(switchId, r) : null;
}

function toDrift(switchId: string, r: RevRow): Drift {
  return {
    switchId,
    from: r.drift_from ?? '',
    to: r.drift_to ?? '',
    by: r.drift_by,
    detectedAt: (r.drift_at ?? new Date(0)).toISOString(),
  };
}

/**
 * Drifts this user has not refreshed past yet (optionally one switch), with
 * each switch's groups so screens can filter by scope.
 */
export async function unseenDrifts(
  userSub: string,
  switchId?: string,
): Promise<Array<Drift & { groups: string[] }>> {
  const { rows } = await db().query<RevRow & { switch_id: string; groups: string[] }>(
    `SELECT r.*, COALESCE(array_agg(sg.group_id) FILTER (WHERE sg.group_id IS NOT NULL), '{}') AS groups
     FROM switch_revisions r
     LEFT JOIN drift_acks a ON a.switch_id = r.switch_id AND a.user_sub = $1
     LEFT JOIN switch_groups sg ON sg.switch_id = r.switch_id
     WHERE r.drift_at IS NOT NULL AND (a.acked_at IS NULL OR a.acked_at < r.drift_at)
       AND ($2::text IS NULL OR r.switch_id = $2)
     GROUP BY r.switch_id ORDER BY r.switch_id`,
    [userSub, switchId ?? null],
  );
  return rows.map((r) => ({ ...toDrift(r.switch_id, r), groups: r.groups }));
}

/** Unseen drift on one switch for this user, if any. */
export async function unseenDrift(userSub: string, switchId: string): Promise<Drift | null> {
  const [drift] = await unseenDrifts(userSub, switchId);
  return drift ?? null;
}

/** The user refreshed: their view of the switch is current again. */
export async function ackDrift(userSub: string, switchId: string): Promise<void> {
  await db().query(
    `INSERT INTO drift_acks (user_sub, switch_id, acked_at) VALUES ($1, $2, now())
     ON CONFLICT (user_sub, switch_id) DO UPDATE SET acked_at = now()`,
    [userSub, switchId],
  );
}

/** The drift that landed after this user's draft was cut, if any (draft is stale). */
export async function driftSinceDraft(userSub: string, switchId: string): Promise<Drift | null> {
  const { rows } = await db().query<RevRow>(
    `SELECT r.* FROM switch_revisions r
     JOIN edit_sessions e ON e.switch_id = r.switch_id AND e.user_sub = $1
     WHERE r.switch_id = $2 AND r.drift_at > e.based_at`,
    [userSub, switchId],
  );
  const r = rows[0];
  return r ? toDrift(switchId, r) : null;
}

/** Thrown when a new edit session would start on a view the switch has moved past. */
export class DriftError extends Error {
  readonly status = 409;
  readonly drift: Drift;
  constructor(drift: Drift) {
    super(`${drift.switchId} changed outside the app — refresh before editing`);
    this.drift = drift;
  }
}
