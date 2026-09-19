/**
 * Server sessions (roadmap 0.5). Cookie holds an opaque session id; everything
 * else — including the Keycloak refresh token — lives in Postgres.
 * Refresh tokens are AES-256-GCM encrypted with SESSION_SECRET at rest.
 * Idle sessions die: every touch past the idle window deletes the session,
 * which surfaces as 401 and the UI redirects to re-login (decision 6.11).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { type AuthConfig, issuerOf } from './config.js';
import { type Identity, verifyAccessToken, type KeyProvider } from './oidc.js';

export interface Session {
  id: string;
  identity: Identity;
  /** Epoch ms of last activity. */
  lastSeen: number;
}

interface SessionRow {
  id: string;
  user_sub: string;
  username: string;
  roles: string;
  user_groups: string;
  refresh_enc: string;
  last_seen_at: string;
}

function keyOf(cfg: AuthConfig): Buffer {
  return createHash('sha256').update(cfg.sessionSecret, 'utf8').digest();
}

/** Encrypt a refresh token. Pure — unit-tested. */
export function sealRefresh(refresh: string, cfg: AuthConfig): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(cfg), iv);
  const body = Buffer.concat([cipher.update(refresh, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${body.toString('base64')}.${cipher.getAuthTag().toString('base64')}`;
}

/** Decrypt. Throws on tamper or wrong secret. Pure — unit-tested. */
export function openRefresh(sealed: string, cfg: AuthConfig): string {
  const [iv, body, tag] = sealed.split('.');
  if (!iv || !body || !tag) throw new Error('malformed sealed token');
  const decipher = createDecipheriv('aes-256-gcm', keyOf(cfg), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return decipher.update(Buffer.from(body, 'base64'), undefined, 'utf8') + decipher.final('utf8');
}

/** Create a session from a verified identity + raw refresh token. */
export async function createSession(identity: Identity, refresh: string, cfg: AuthConfig): Promise<Session> {
  const id = randomUUID();
  await db().query(
    'INSERT INTO sessions (id, user_sub, username, roles, user_groups, refresh_enc) VALUES ($1, $2, $3, $4, $5, $6)',
    [
      id,
      identity.sub,
      identity.username,
      JSON.stringify(identity.roles),
      JSON.stringify(identity.groups),
      sealRefresh(refresh, cfg),
    ],
  );
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
  return {
    id: row.id,
    identity: {
      sub: row.user_sub,
      username: row.username,
      roles: JSON.parse(row.roles) as string[],
      groups: JSON.parse(row.user_groups) as string[],
    },
    lastSeen: Date.now(),
  };
}

/** Delete a session. Idempotent. */
export async function deleteSession(id: string): Promise<void> {
  await db().query('DELETE FROM sessions WHERE id = $1', [id]);
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Silent refresh: trade the stored refresh token for fresh tokens at Keycloak,
 * rotate the stored refresh, re-verify identity. Throws on any failure —
 * callers delete the session and answer 401 (→ UI re-login).
 */
export async function refreshSession(
  id: string,
  cfg: AuthConfig,
  fetchFn: typeof fetch = fetch,
  keys?: KeyProvider,
): Promise<{ identity: Identity; expiresIn: number }> {
  const { rows } = await db().query<SessionRow>('SELECT * FROM sessions WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) throw new Error('unknown session');
  const refresh = openRefresh(row.refresh_enc, cfg);
  const res = await fetchFn(`${issuerOf(cfg)}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cfg.clientId,
      refresh_token: refresh,
    }),
  });
  if (!res.ok) throw new Error(`refresh rejected: ${res.status}`);
  const tokens = (await res.json()) as TokenResponse;
  const identity = await verifyAccessToken(tokens.access_token, cfg, keys);
  await db().query(
    'UPDATE sessions SET user_sub = $2, username = $3, roles = $4, user_groups = $5, refresh_enc = $6, last_seen_at = now() WHERE id = $1',
    [
      id,
      identity.sub,
      identity.username,
      JSON.stringify(identity.roles),
      JSON.stringify(identity.groups),
      sealRefresh(tokens.refresh_token, cfg),
    ],
  );
  return { identity, expiresIn: tokens.expires_in };
}
