/**
 * Inventory tests (roadmap 0.4). Need Postgres: `docker compose up -d db`.
 * Skipped when unreachable — CI always provides it, so coverage is enforced there.
 * Routes are gated (0.8): tests authenticate as app-admin.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { Pool, type Pool as PoolType } from 'pg';
import { buildApp } from './app.js';
import { migrate } from './db.js';
import { verifyFingerprint } from './inventory/store.js';
import { type AuthConfig } from './auth/config.js';
import { sessionCookie } from './test-sessions.js';

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
if (!LIVE) console.warn('inventory tests skipped: DATABASE_URL unreachable (start db via compose)');

describe('verifyFingerprint (pure)', () => {
  it('matches case-insensitively, refuses unenrolled and mismatched', () => {
    expect(verifyFingerprint('SHA256:AB', 'sha256:ab')).toBe(true);
    expect(verifyFingerprint(null, 'SHA256:AB')).toBe(false);
    expect(verifyFingerprint('SHA256:AB', 'SHA256:CD')).toBe(false);
  });
});

describe.skipIf(!LIVE)('inventory api', () => {
  let pool: PoolType;

  beforeAll(async () => {
    await migrate();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  it('migrate is idempotent', async () => {
    expect(await migrate()).toEqual([]);
  });

  it('groups + switches CRUD with membership', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const cookie = await sessionCookie(pool, 'inv-admin', { appRoles: ['app-admin'] });
    const api = request(app.server);
    try {
      await api.delete('/api/v1/inventory/switches/leaf01').set('Cookie', cookie);
      const g = await api
        .post('/api/v1/inventory/groups')
        .set('Cookie', cookie)
        .send({ id: 'DC1-leaf', display_name: 'DC1 leafs' });
      expect([201, 409]).toContain(g.status);

      const s = await api.post('/api/v1/inventory/switches').set('Cookie', cookie).send({
        id: 'leaf01',
        display_name: 'leaf01',
        base_url: 'https://leaf01:8765',
        cert_fingerprint: 'SHA256:AA',
      });
      expect(s.status).toBe(201);
      expect(s.body.cert_fingerprint).toBe('SHA256:AA');

      const dup = await api.post('/api/v1/inventory/switches').set('Cookie', cookie).send({
        id: 'leaf01',
        display_name: 'dup',
        base_url: 'https://x:8765',
        cert_fingerprint: 'SHA256:BB',
      });
      expect(dup.status).toBe(409);

      const bad = await api.post('/api/v1/inventory/switches').set('Cookie', cookie).send({ id: 'x' });
      expect(bad.status).toBe(400);

      const set = await api
        .put('/api/v1/inventory/switches/leaf01/groups')
        .set('Cookie', cookie)
        .send({ groups: ['DC1-leaf'] });
      expect(set.status).toBe(200);

      const list = await api.get('/api/v1/inventory/switches').set('Cookie', cookie);
      expect(list.body.find((x: { id: string }) => x.id === 'leaf01').groups).toEqual(['DC1-leaf']);

      const del = await api.delete('/api/v1/inventory/switches/leaf01').set('Cookie', cookie);
      expect(del.status).toBe(200);
      const gone = await api.delete('/api/v1/inventory/switches/leaf01').set('Cookie', cookie);
      expect(gone.status).toBe(404);
    } finally {
      await pool.query(`DELETE FROM sessions WHERE user_sub = 'inv-admin'`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub = 'inv-admin'`);
      await app.close();
    }
  });

  it('anonymous and unauthorized callers are refused (and denials audited)', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const api = request(app.server);
    try {
      expect(await api.get('/api/v1/inventory/switches')).toMatchObject({ status: 401 });
      const viewer = await sessionCookie(pool, 'inv-viewer', { appRoles: ['viewer'] });
      expect(await api.get('/api/v1/inventory/switches').set('Cookie', viewer)).toMatchObject({
        status: 403,
      });
      expect(await api.post('/api/v1/inventory/groups').set('Cookie', viewer).send({})).toMatchObject({
        status: 403,
      });
      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM audit_log WHERE user_sub = 'inv-viewer' AND path LIKE '/api/v1/inventory%' AND method != 'GET'`,
      );
      expect(Number(rows[0]?.count)).toBeGreaterThan(0);
      await pool.query(`DELETE FROM sessions WHERE user_sub = 'inv-viewer'`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub = 'inv-viewer'`);
    } finally {
      await app.close();
    }
  });
});
