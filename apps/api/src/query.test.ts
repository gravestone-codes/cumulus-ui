/**
 * Read-proxy tests (Phase 2 backend): gate → manifest → switch → data.
 * Fake NVUE answers collection + object reads.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { Pool, type Pool as PoolType } from 'pg';
import { buildApp } from './app.js';
import { migrate, db } from './db.js';
import { type AuthConfig } from './auth/config.js';
import { sessionCookie } from './test-sessions.js';
import { setSwitchCredential } from './users/store.js';
import { setSwitchToken, dropUserTokens } from './switchauth/sessions.js';
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
if (!LIVE) console.warn('query tests skipped: DATABASE_URL unreachable');

describe.skipIf(!LIVE)('read proxy + manifest', () => {
  let pool: PoolType;

  beforeAll(async () => {
    await migrate();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  it('proxies gated reads, denies the rest, serves the manifest', async () => {
    const fake = await startFakeNvue((req, res) => {
      const url = new URL(req.url ?? '/', 'https://x');
      if (url.pathname === '/nvue_v1/interface' && !url.searchParams.has('rev')) {
        json(res, 200, { swp1: { state: 'up' }, swp2: { state: 'down' } });
      } else if (url.pathname === '/nvue_v1/interface/swp1') {
        json(res, 200, { state: 'up', speed: '10G' });
      } else {
        json(res, 404, { message: 'nope' });
      }
    });
    await db().query(
      `INSERT INTO switches (id, display_name, base_url, cert_fingerprint, cert_pem) VALUES ('swq', 't', $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url, cert_fingerprint = EXCLUDED.cert_fingerprint, cert_pem = EXCLUDED.cert_pem`,
      [fake.baseUrl, fake.pin, fake.caPem],
    );
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const op = await sessionCookie(pool, 'qw-op', { appRoles: ['net-operator'] });
    setSwitchToken('qw-op', 'swq', 'stub-jwt');
    const viewer = await sessionCookie(pool, 'qw-viewer', { appRoles: ['viewer'] });
    setSwitchToken('qw-viewer', 'swq', 'stub-jwt');
    const admin = await sessionCookie(pool, 'qw-admin', { appRoles: ['app-admin'] });
    setSwitchToken('qw-admin', 'swq', 'stub-jwt');
    const api = request(app.server);
    try {
      expect(await api.get('/api/v1/switches/swq/query')).toMatchObject({ status: 401 });

      const adminList = await api
        .get('/api/v1/switches/swq/query')
        .set('Cookie', admin)
        .query({ path: '/interface' });
      expect(adminList.status).toBe(200);
      expect(adminList.body.data).toEqual({ swp1: { state: 'up' }, swp2: { state: 'down' } });

      const list = await api
        .get('/api/v1/switches/swq/query')
        .set('Cookie', op)
        .query({ path: '/interface' });
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual({ swp1: { state: 'up' }, swp2: { state: 'down' } });

      const rev = await api
        .get('/api/v1/switches/swq/query')
        .set('Cookie', op)
        .query({ path: '/interface/swp1', rev: 'applied' });
      expect(rev.status).toBe(200);
      expect(rev.body.data).toEqual({ state: 'up', speed: '10G' });

      const unknown = await api.get('/api/v1/switches/swq/query').set('Cookie', op).query({ path: '/nope' });
      expect(unknown.status).toBe(400);

      const manifest = await api.get('/api/v1/spec/manifest').set('Cookie', viewer);
      expect(manifest.status).toBe(200);
      expect(manifest.body.routes['/interface']).toContain('get');
      expect(await api.get('/api/v1/spec/manifest')).toMatchObject({ status: 401 });
    } finally {
      dropUserTokens('qw-op');
      dropUserTokens('qw-viewer');
      dropUserTokens('qw-admin');
      await pool.query(`DELETE FROM sessions WHERE user_sub IN ('qw-op', 'qw-viewer', 'qw-admin')`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub IN ('qw-op', 'qw-viewer', 'qw-admin')`);
      await pool.query('DELETE FROM switches WHERE id = $1', ['swq']);
      await pool.end();
      await fake.close();
      await app.close();
    }
  });

  it('silently re-mints an expired switch token from the sealed credential', async () => {
    const pool2: PoolType = new Pool({ connectionString: process.env.DATABASE_URL });
    const fake = await startFakeNvue((req, res) => {
      const url = new URL(req.url ?? '/', 'https://x');
      if (url.pathname === '/nvue_v1/api-token') {
        json(res, 200, { token: 'fresh-jwt' });
      } else if (url.pathname === '/nvue_v1/interface') {
        json(res, 200, { swp1: {} });
      } else {
        json(res, 404, { message: 'nope' });
      }
    });
    await db().query(
      `INSERT INTO switches (id, display_name, base_url, cert_fingerprint, cert_pem) VALUES ('swm', 't', $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url, cert_fingerprint = EXCLUDED.cert_fingerprint, cert_pem = EXCLUDED.cert_pem`,
      [fake.baseUrl, fake.pin, fake.caPem],
    );
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const cookie = await sessionCookie(pool2, 'qw-minter', { appRoles: ['net-operator'] });
    await setSwitchCredential('qw-minter', 'swm', 'cumulus', 's3cret', CFG.credKey);
    const api = request(app.server);
    try {
      // No switch token set: the read must mint from the sealed credential.
      const first = await api
        .get('/api/v1/switches/swm/query')
        .set('Cookie', cookie)
        .query({ path: '/interface' });
      expect(first.status).toBe(200);
      expect(first.body.data).toEqual({ swp1: {} });
      const second = await api
        .get('/api/v1/switches/swm/query')
        .set('Cookie', cookie)
        .query({ path: '/interface' });
      expect(second.status).toBe(200);
    } finally {
      dropUserTokens('qw-minter');
      await pool2.query(`DELETE FROM sessions WHERE user_sub = 'qw-minter'`);
      await pool2.query(`DELETE FROM user_roles WHERE user_sub = 'qw-minter'`);
      await pool2.query(`DELETE FROM switch_credentials WHERE user_sub = 'qw-minter'`);
      await pool2.query(`DELETE FROM users WHERE id = 'qw-minter'`);
      await pool2.query('DELETE FROM switches WHERE id = $1', ['swm']);
      await pool2.end();
      await fake.close();
      await app.close();
    }
  });
});
