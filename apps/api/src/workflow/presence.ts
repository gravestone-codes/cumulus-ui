/**
 * Presence (roadmap 1.2/R19): soft coordination, never enforcement.
 * Editors heartbeat (switch, path); readers see who else is here — an open
 * editor (fresh heartbeat) or unapplied staged work. Rows older than
 * STALE_AFTER_MS are ignored, never deleted on read (the table stays tiny).
 */
import { db } from '../db.js';
import type { StagedPath } from './branches.js';

export const STALE_AFTER_MS = 90_000;

/** Another user on this switch, narrowed to the asked path when one is given. */
export interface PresenceEntry {
  userSub: string;
  username: string;
  /** Has an editor open (fresh heartbeat). */
  open: boolean;
  /** Unapplied staged paths (overlapping the asked path). */
  staged: number;
  /** Latest heartbeat, if any. */
  updatedAt: string | null;
}

/** Same object or one inside the other — `/interface/swp1` vs `/interface/swp1/link`. */
export const overlaps = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** Upsert a heartbeat. Idempotent — called every ~30s per open editor. */
export async function heartbeat(
  userSub: string,
  username: string,
  switchId: string,
  path: string,
): Promise<void> {
  await db().query(
    `INSERT INTO presence (user_sub, username, switch_id, path, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (user_sub, switch_id, path) DO UPDATE SET updated_at = now(), username = $2`,
    [userSub, username, switchId, path],
  );
}

/** Who else is here (excludes the caller and stale heartbeats), newest first. */
export async function presentOthers(
  userSub: string,
  switchId: string,
  path?: string,
): Promise<PresenceEntry[]> {
  const pool = db();
  const [beats, sessions] = await Promise.all([
    pool.query<{ userSub: string; username: string; path: string; updatedAt: string }>(
      `SELECT user_sub AS "userSub", username, path, updated_at AS "updatedAt" FROM presence
       WHERE switch_id = $1 AND user_sub <> $2 AND updated_at > now() - make_interval(secs => $3)
       ORDER BY updated_at DESC`,
      [switchId, userSub, STALE_AFTER_MS / 1000],
    ),
    pool.query<{ userSub: string; username: string; staged: StagedPath[] }>(
      `SELECT e.user_sub AS "userSub", COALESCE(u.display_name, e.user_sub) AS username,
              e.staged_paths AS staged
       FROM edit_sessions e LEFT JOIN users u ON u.id = e.user_sub
       WHERE e.switch_id = $1 AND e.user_sub <> $2 AND jsonb_array_length(e.staged_paths) > 0`,
      [switchId, userSub],
    ),
  ]);
  const hit = (p: string) => path === undefined || overlaps(p, path);
  const out = new Map<string, PresenceEntry>();
  for (const b of beats.rows) {
    if (!hit(b.path) || out.has(b.userSub)) continue;
    out.set(b.userSub, {
      userSub: b.userSub,
      username: b.username,
      open: true,
      staged: 0,
      updatedAt: b.updatedAt,
    });
  }
  for (const s of sessions.rows) {
    const staged = s.staged.filter((p) => hit(p.path)).length;
    if (staged === 0) continue;
    const seen = out.get(s.userSub);
    if (seen) seen.staged = staged;
    else
      out.set(s.userSub, { userSub: s.userSub, username: s.username, open: false, staged, updatedAt: null });
  }
  return [...out.values()];
}
