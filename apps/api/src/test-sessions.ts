/** Shared DB-test helper: mint a session cookie for a platform user. */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export async function sessionCookie(
  pool: Pool,
  sub: string,
  opts: { appRoles?: string[] } = {},
): Promise<string> {
  const id = randomUUID();
  // Sessions only exist for real users — mirror production (login requires a users row).
  await pool.query(
    `INSERT INTO users (id, display_name, password_hash) VALUES ($1, $2, '!unusable')
     ON CONFLICT (id) DO NOTHING`,
    [sub, sub],
  );
  await pool.query('INSERT INTO sessions (id, user_sub, username) VALUES ($1, $2, $3)', [id, sub, sub]);
  await pool.query('DELETE FROM user_roles WHERE user_sub = $1', [sub]);
  for (const r of opts.appRoles ?? []) {
    await pool.query('INSERT INTO user_roles (user_sub, role_id) VALUES ($1, $2)', [sub, r]);
  }
  return `cumulus_session=${id}`;
}

/** Ensure a platform user exists (idempotent). */
export async function ensureUser(pool: Pool, sub: string, passwordHash: string): Promise<void> {
  await pool.query(
    `INSERT INTO users (id, display_name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET password_hash = $3`,
    [sub, sub, passwordHash],
  );
}
