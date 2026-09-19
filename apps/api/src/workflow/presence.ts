/**
 * Presence (roadmap 1.2/R19): soft coordination, never enforcement.
 * Editors heartbeat (switch, path); readers see who else is here with
 * unapplied work. Rows older than STALE_AFTER_MS are ignored, never deleted
 * on read (a periodic sweep is unnecessary — presence table stays tiny).
 */
import { db } from '../db.js';

export const STALE_AFTER_MS = 90_000;

export interface PresenceEntry {
  userSub: string;
  username: string;
  path: string;
  updatedAt: string;
}

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

/** Who else is here (excludes the caller, excludes stale). */
export async function presentOthers(
  userSub: string,
  switchId: string,
  excludePaths: string[] = [],
): Promise<PresenceEntry[]> {
  const { rows } = await db().query<PresenceEntry>(
    `SELECT user_sub AS "userSub", username, path, updated_at AS "updatedAt" FROM presence
     WHERE switch_id = $1 AND user_sub <> $2 AND updated_at > now() - make_interval(secs => $3)
     ORDER BY updated_at DESC`,
    [switchId, userSub, STALE_AFTER_MS / 1000],
  );
  return excludePaths.length > 0 ? rows.filter((r) => !excludePaths.includes(r.path)) : rows;
}
