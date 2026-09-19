/**
 * User management tests: platform users + switch-credential extension,
 * admin self-protection, and role grants through the API.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { Pool, type Pool as PoolType } from 'pg';
import { buildApp } from './app.js';
import { migrate, db } from './db.js';
import { type AuthConfig } from './auth/config.js';
import { sessionCookie } from './test-sessions.js';
import { getSwitchCredential } from './users/store.js';

const CFG: AuthConfig = { credKey: 'test-cred-key-long-enough-12345', idleMinutes: 30 };

async function dbReachable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 2000 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

const LIVE = await dbReachable();
if (!LIVE) console.warn('users tests skipped: DATABASE_URL unreachable');

describe.skipIf(!LIVE)('users + switch credentials', () => {
  let pool: PoolType;

  beforeAll(async () => {
    await migrate();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  it('admin CRUD: create, list, patch, grant, delete — never self', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const admin = await sessionCookie(pool, 'root-admin', { appRoles: ['app-admin'] });
    const api = request(app.server);
    try {
      const created = await api
        .post('/api/v1/users')
        .set('Cookie', admin)
        .send({ id: 'tech9', display_name: 'Tech Nine', password: 'tech9-password-123' });
      expect(created.status).toBe(201);
      expect(
        await api
          .post('/api/v1/users')
          .set('Cookie', admin)
          .send({ id: 'tech9', display_name: 'x', password: 'tech9-password-123' }),
      ).toMatchObject({
        status: 409,
      });
      expect(
        await api
          .post('/api/v1/users')
          .set('Cookie', admin)
          .send({ id: 'weak', display_name: 'x', password: 'short' }),
      ).toMatchObject({ status: 400 });

      const listed = await api.get('/api/v1/users').set('Cookie', admin);
      expect(listed.body.map((u: { id: string }) => u.id)).toContain('tech9');
      expect(listed.body.find((u: { id: string }) => u.id === 'tech9')).not.toHaveProperty('password_hash');

      const login = await api
        .post('/api/v1/auth/login')
        .send({ username: 'tech9', password: 'tech9-password-123' });
      expect(login.status).toBe(200);

      const patched = await api.patch('/api/v1/users/tech9').set('Cookie', admin).send({ disabled: true });
      expect(patched.body.disabled).toBe(true);
      expect(
        await api.post('/api/v1/auth/login').send({ username: 'tech9', password: 'tech9-password-123' }),
      ).toMatchObject({
        status: 401,
      });

      expect(await api.delete('/api/v1/users/root-admin').set('Cookie', admin)).toMatchObject({
        status: 409,
      });
      expect(
        (await api.patch('/api/v1/users/root-admin').set('Cookie', admin).send({ disabled: true })).status,
      ).toBe(409);

      const granted = await api
        .post('/api/v1/users/tech9/roles')
        .set('Cookie', admin)
        .send({ role_id: 'viewer' });
      expect(granted.status).toBe(200);

      expect(await api.delete('/api/v1/users/tech9').set('Cookie', admin)).toMatchObject({ status: 200 });
      expect(await api.delete('/api/v1/users/tech9').set('Cookie', admin)).toMatchObject({ status: 404 });
    } finally {
      await pool.query(`DELETE FROM user_roles WHERE user_sub IN ('root-admin', 'tech9')`);
      await pool.query(`DELETE FROM sessions WHERE user_sub IN ('root-admin', 'tech9')`);
      await pool.query(`DELETE FROM users WHERE id IN ('root-admin', 'tech9')`);
      await app.close();
    }
  });

  it('non-admins cannot manage users', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const viewer = await sessionCookie(pool, 'plain-user', { appRoles: ['viewer'] });
    const api = request(app.server);
    try {
      expect(await api.get('/api/v1/users').set('Cookie', viewer)).toMatchObject({ status: 403 });
      expect(await api.post('/api/v1/users').set('Cookie', viewer).send({})).toMatchObject({ status: 403 });
    } finally {
      await pool.query(`DELETE FROM sessions WHERE user_sub = 'plain-user'`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub = 'plain-user'`);
      await app.close();
    }
  });

  it('switch credentials round-trip encrypted, usernames listable without passwords', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const admin = await sessionCookie(pool, 'root-admin2', { appRoles: ['app-admin'] });
    const api = request(app.server);
    try {
      await db().query(
        `INSERT INTO switches (id, display_name, base_url) VALUES ('swcred', 't', 'https://x:8765')
         ON CONFLICT (id) DO NOTHING`,
      );
      await api
        .post('/api/v1/users')
        .set('Cookie', admin)
        .send({ id: 'techx', display_name: 'Tech X', password: 'techx-password-123' });
      const put = await api
        .put('/api/v1/users/techx/switch-credentials/swcred')
        .set('Cookie', admin)
        .send({ switch_username: 'op', switch_password: 's3cret-op-pass' });
      expect(put.status).toBe(200);
      const stored = await getSwitchCredential('techx', 'swcred', CFG.credKey);
      expect(stored).toEqual({ switchUsername: 'op', password: 's3cret-op-pass' });
      const raw = await pool.query<{ password_enc: string }>(
        `SELECT password_enc FROM switch_credentials WHERE user_sub = 'techx'`,
      );
      expect(raw.rows[0]?.password_enc).not.toContain('s3cret');
      const listed = await api.get('/api/v1/users/techx/switch-credentials').set('Cookie', admin);
      expect(listed.body).toEqual([{ switchId: 'swcred', switchUsername: 'op' }]);
    } finally {
      await pool.query(`DELETE FROM switch_credentials WHERE user_sub = 'techx'`);
      await pool.query(`DELETE FROM switches WHERE id = 'swcred'`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub IN ('root-admin2', 'techx')`);
      await pool.query(`DELETE FROM sessions WHERE user_sub = 'root-admin2'`);
      await pool.query(`DELETE FROM users WHERE id IN ('root-admin2', 'techx')`);
      await app.close();
    }
  });
});
