/**
 * RevisionManager sessions (roadmap 1.1/R4): one active staging branch per
 * (user, switch). Opening a second branch while unapplied changes exist is a
 * 409 — conscious discard only, never silent divergence.
 */
import { db } from '../db.js';
import { clientFor, tokenFor } from '../nvue/clients.js';
import { createBranch } from '../nvue/revisions.js';

export interface StagedPath {
  path: string;
  method: string;
  /** Operational value snapshot taken at stage time (OCC before-image). */
  before: unknown;
  /** Our staged intent (PATCH body, null for DELETE). Absent on pre-1.3 rows. */
  after?: unknown;
}

export interface EditSession {
  userSub: string;
  switchId: string;
  branch: string;
  baseRev: string | null;
  staged: StagedPath[];
}

interface SessionRow {
  user_sub: string;
  switch_id: string;
  branch: string;
  base_rev: string | null;
  staged_paths: StagedPath[];
}

function toSession(row: SessionRow): EditSession {
  return {
    userSub: row.user_sub,
    switchId: row.switch_id,
    branch: row.branch,
    baseRev: row.base_rev,
    staged: row.staged_paths ?? [],
  };
}

/** Current session, if any. */
export async function getEditSession(userSub: string, switchId: string): Promise<EditSession | null> {
  const { rows } = await db().query<SessionRow>(
    'SELECT * FROM edit_sessions WHERE user_sub = $1 AND switch_id = $2',
    [userSub, switchId],
  );
  const row = rows[0];
  return row ? toSession(row) : null;
}

export class BranchConflictError extends Error {
  readonly branch: string;
  constructor(branch: string) {
    super(`unapplied changes already staged on branch ${branch} — discard first`);
    this.branch = branch;
  }
}

/** Open a branch. 409s when unapplied changes exist; replaces empty sessions silently. */
export async function openBranch(userSub: string, switchId: string): Promise<EditSession> {
  const existing = await getEditSession(userSub, switchId);
  if (existing && existing.staged.length > 0) throw new BranchConflictError(existing.branch);
  const { client } = await clientFor(userSub, switchId);
  const { branch, baseRev } = await createBranch(client, tokenFor(userSub, switchId));
  await db().query(
    `INSERT INTO edit_sessions (user_sub, switch_id, branch, base_rev, staged_paths, updated_at)
     VALUES ($1, $2, $3, $4, '[]', now())
     ON CONFLICT (user_sub, switch_id) DO UPDATE SET branch = $3, base_rev = $4, staged_paths = '[]', updated_at = now()`,
    [userSub, switchId, branch, baseRev],
  );
  return { userSub, switchId, branch, baseRev, staged: [] };
}

/** Append a staged path snapshot (atomic array concat). */
export async function addStagedPath(userSub: string, switchId: string, staged: StagedPath): Promise<void> {
  await db().query(
    `UPDATE edit_sessions SET staged_paths = staged_paths || $3::jsonb, updated_at = now()
     WHERE user_sub = $1 AND switch_id = $2`,
    [userSub, switchId, JSON.stringify([staged])],
  );
}

/** Discard a session. Switch-side cleanup is best-effort — reported, never fatal. */
export async function discardBranch(
  userSub: string,
  switchId: string,
): Promise<{ switchDiscarded: boolean }> {
  const existing = await getEditSession(userSub, switchId);
  await db().query('DELETE FROM edit_sessions WHERE user_sub = $1 AND switch_id = $2', [userSub, switchId]);
  if (!existing) return { switchDiscarded: false };
  try {
    const { client } = await clientFor(userSub, switchId);
    // DELETE-revision shape unconfirmed on hardware (M1 validates) — failure stays best-effort.
    await client.call({
      path: `/revision/${encodeURIComponent(existing.branch)}`,
      method: 'DELETE',
      token: tokenFor(userSub, switchId),
    });
    return { switchDiscarded: true };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    return { switchDiscarded: false };
  }
}

/** Delete sessions older than maxAgeDays. Returns count (switch-side orphans left for NVUE GC). */
export async function purgeEditSessions(maxAgeDays = 7): Promise<number> {
  const { rowCount } = await db().query(
    `DELETE FROM edit_sessions WHERE updated_at < now() - make_interval(days => $1)`,
    [maxAgeDays],
  );
  return rowCount ?? 0;
}
