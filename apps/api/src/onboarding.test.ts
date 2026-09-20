/**
 * Onboarding tests (roadmap §8): first-boot setup, trust ceremony, verify
 * probe, bulk import, and the dev-only reset button backend.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool, type Pool as PoolType } from 'pg';
import { buildApp } from './app.js';
import { migrate } from './db.js';
import { type AuthConfig } from './auth/config.js';
import { sessionCookie } from './test-sessions.js';
import { startFakeNvue, json } from './test-nvue.js';

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
if (!LIVE) console.warn('onboarding tests skipped: DATABASE_URL unreachable');

describe.skipIf(!LIVE)('onboarding', () => {
  let pool: PoolType;

  afterAll(async () => {
    await pool.end();
  });

  beforeAll(async () => {
    await migrate();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  it('first boot: setup status, create admin, locked after', async () => {
    // Files run sequentially (singleFork) sharing one DB: a plain committed
    // wipe is deterministic here — no locks needed.
    await pool.query('DELETE FROM users');
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const api = request(app.server);
    try {
      expect((await api.get('/api/v1/setup/status')).body).toEqual({ initialized: false });
      const created = await api
        .post('/api/v1/setup/admin')
        .send({ id: 'boss', display_name: 'Boss', password: 'boss-password-123' });
      expect(created.status).toBe(200);
      expect(created.body.user.id).toBe('boss');
      expect(String(created.headers['set-cookie'])).toContain('cumulus_session');
      expect((await api.get('/api/v1/setup/status')).body).toEqual({ initialized: true });
      expect(
        await api.post('/api/v1/setup/admin').send({ id: 'x', display_name: 'x', password: 'x'.repeat(12) }),
      ).toMatchObject({
        status: 404,
      });
      const login = await api
        .post('/api/v1/auth/login')
        .send({ username: 'boss', password: 'boss-password-123' });
      expect(login.status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('trust ceremony, verify probe, bulk import, dev reset', async () => {
    const fake = await startFakeNvue((req, res) => {
      const url = new URL(req.url ?? '/', 'https://x');
      if (req.method === 'GET' && url.pathname === '/nvue_v1/system') json(res, 200, { hostname: 'leaf9' });
      else if (req.method === 'GET' && url.pathname === '/nvue_v1/api-token' && req.headers.authorization) {
        json(res, 200, { token: 'ceremony-jwt' });
      } else json(res, 404, { message: 'nope' });
    });
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const cookie = await sessionCookie(pool, 'boss', { appRoles: ['app-admin'] });
    const api = request(app.server);
    try {
      // single-switch ceremony: inventory create returns the live fingerprint
      const added = await api.post('/api/v1/inventory/switches').set('Cookie', cookie).send({
        id: 'leaf9',
        display_name: 'leaf9',
        base_url: fake.baseUrl,
      });
      expect(added.status).toBe(201);
      expect(added.body.cert_fingerprint).toBe(fake.pin);
      expect(added.body.trust_verified ?? false).toBe(false);

      expect(
        await api
          .post('/api/v1/inventory/switches/leaf9/trust')
          .set('Cookie', cookie)
          .send({ fingerprint: 'SHA256:WRONG' }),
      ).toMatchObject({ status: 409 });
      const trusted = await api
        .post('/api/v1/inventory/switches/leaf9/trust')
        .set('Cookie', cookie)
        .send({ fingerprint: fake.pin });
      expect(trusted.body).toEqual({ ok: true, trust_verified: true });

      await api
        .put('/api/v1/me/switch-credentials/leaf9')
        .set('Cookie', cookie)
        .send({ switch_username: 'op', switch_password: 'pw' });
      expect(await api.post('/api/v1/switch-auth/leaf9').set('Cookie', cookie)).toMatchObject({
        status: 204,
      });
      const verified = await api.post('/api/v1/switches/leaf9/verify').set('Cookie', cookie);
      expect(verified.status).toBe(200);
      expect(verified.body.data).toEqual({ hostname: 'leaf9' });
      const row = await pool.query<{ last_check_ok: boolean }>(
        `SELECT last_check_ok FROM switches WHERE id = 'leaf9'`,
      );
      expect(row.rows[0]?.last_check_ok).toBe(true);

      // bulk: one good row (live TLS), one unreachable
      await pool.query(`INSERT INTO groups (id, display_name) VALUES ('DC9', 't') ON CONFLICT DO NOTHING`);
      const bulk = await api
        .post('/api/v1/inventory/import')
        .set('Cookie', cookie)
        .send({
          rows: [
            {
              id: 'bulk1',
              display_name: 'b1',
              base_url: fake.baseUrl,
              group: 'DC9',
              switch_username: 'op',
              switch_password: 'pw',
            },
            {
              id: 'bulk2',
              display_name: 'b2',
              base_url: 'https://127.0.0.1:1',
              switch_username: 'op',
              switch_password: 'pw',
            },
          ],
        });
      expect(bulk.status).toBe(200);
      const byId = Object.fromEntries(bulk.body.results.map((r: { id: string }) => [r.id, r]));
      expect(byId.bulk1.ok).toBe(true);
      expect(byId.bulk1.trust_verified).toBe(false);
      expect(byId.bulk2.ok).toBe(false);

      // dev reset wipes back to setup
      const reset = await api.post('/api/v1/dev/reset').set('Cookie', cookie);
      expect(reset.body).toEqual({ ok: true, reset: true });
      expect((await api.get('/api/v1/setup/status')).body).toEqual({ initialized: false });
    } finally {
      await pool.query(`DELETE FROM switch_credentials WHERE user_sub = 'boss'`);
      await pool.query(`DELETE FROM sessions WHERE user_sub = 'boss'`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub = 'boss'`);
      await pool.query(`DELETE FROM users WHERE id = 'boss'`);
      await pool.query(`DELETE FROM switch_groups WHERE switch_id IN ('leaf9', 'bulk1', 'bulk2')`);
      await pool.query(`DELETE FROM switches WHERE id IN ('leaf9', 'bulk1', 'bulk2')`);
      await pool.query(`DELETE FROM groups WHERE id = 'DC9'`);
      await fake.close();
      await app.close();
    }
  });
});
