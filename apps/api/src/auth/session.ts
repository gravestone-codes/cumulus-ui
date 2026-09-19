/**
 * Server sessions (roadmap: platform users own their sessions).
 * The cookie holds an opaque session id; identity lives here. Roles are read
 * fresh from user_roles on every call — revocation applies at the next request,
 * not the next login. Idle sessions die: staleness surfaces as 401 → re-login.
 */
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { type AuthConfig } from './config.js';

export interface Identity {
  sub: string;
  username: string;
}

export interface Session {
  id: string;
  identity: Identity;
  lastSeen: number;
}

interface SessionRow {
  id: string;
  user_sub: string;
  username: string;
  last_seen_at: string;
}

/** Create a session for a verified platform user. */
export async function createSession(identity: Identity): Promise<Session> {
  const id = randomUUID();
  await db().query('INSERT INTO sessions (id, user_sub, username) VALUES ($1, $2, $3)', [
    id,
    identity.sub,
    identity.username,
  ]);
  return { id, identity, lastSeen: Date.now() };
}

/** Load a session, enforcing the idle window. Returns null when gone or idle-timed-out. */
export async function getSession(id: string, cfg: AuthConfig): Promise<Session | null> {
  const { rows } = await db().query<SessionRow>('SELECT * FROM sessions WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return null;
  const lastSeen = Date.parse(row.last_seen_at);
  if (Date.now() - lastSeen > cfg.idleMinutes * 60_000) {
    await db().query('DELETE FROM sessions WHERE id = $1', [id]);
    return null;
  }
  await db().query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [id]);
  return { id, identity: { sub: row.user_sub, username: row.username }, lastSeen: Date.now() };
}

/** Delete a session. Idempotent. */
export async function deleteSession(id: string): Promise<void> {
  await db().query('DELETE FROM sessions WHERE id = $1', [id]);
}
