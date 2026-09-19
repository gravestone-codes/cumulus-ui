/** Shared DB-test helper: mint a session cookie. Fourth copy → promoted (rule of three). */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export async function sessionCookie(
  pool: Pool,
  sub: string,
  opts: { keycloakRoles?: string[]; appRoles?: string[] } = {},
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO sessions (id, user_sub, username, roles, user_groups, refresh_enc) VALUES ($1, $2, $3, $4, '[]', 'sealed')`,
    [id, sub, sub, JSON.stringify(opts.keycloakRoles ?? [])],
  );
  await pool.query('DELETE FROM user_roles WHERE user_sub = $1', [sub]);
  for (const r of opts.appRoles ?? []) {
    await pool.query('INSERT INTO user_roles (user_sub, role_id) VALUES ($1, $2)', [sub, r]);
  }
  return `cumulus_session=${id}`;
}
