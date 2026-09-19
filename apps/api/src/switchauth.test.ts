/**
 * Switch-auth route tests (roadmap 0.6). Mint flow uses a stub transport;
 * TOFU pinning is proven live against a local HTTPS stub with an
 * openssl-generated certificate. Needs Postgres + openssl.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from './app.js';
import { migrate, db } from './db.js';
import { type AuthConfig } from './auth/config.js';
import { sessionCookie } from './test-sessions.js';
import { dropUserTokens } from './switchauth/sessions.js';
import type { JsonRequest } from './nvue/tls.js';

const CFG: AuthConfig = {
  keycloakUrl: 'https://kc.test',
  realm: 't',
  clientId: 'cumulus-ui',
  sessionSecret: 'test-secret-that-is-long-enough-123',
  idleMinutes: 30,
};

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
if (!LIVE) console.warn('switchauth tests skipped: DATABASE_URL unreachable');

function stubFetch(expectedPass: string, token: string) {
  return async (req: JsonRequest): Promise<unknown> => {
    if (req.password !== expectedPass) throw new Error('bad credentials');
    return { token };
  };
}

describe.skipIf(!LIVE)('switch-auth routes', () => {
  beforeAll(async () => {
    await migrate();
  });

  it('session + scope gated mint, status, drop', async () => {
    const app = await buildApp({ auth: { cfg: CFG, fetchJsonFn: stubFetch('pw', 'jwt-abc') } });
    await app.ready();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const api = request(app.server);
    await db().query(
      `INSERT INTO switches (id, display_name, base_url, cert_fingerprint, cert_pem) VALUES ('swt', 't', 'https://swt:8765', 'SHA256:AA', 'stub-pem')
       ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url, cert_fingerprint = EXCLUDED.cert_fingerprint, cert_pem = EXCLUDED.cert_pem`,
    );
    try {
      expect(await api.post('/api/v1/switch-auth/swt').send({ password: 'pw' })).toMatchObject({
        status: 401,
      });

      const viewer = await sessionCookie(pool, 'sw-user', { appRoles: ['viewer'] });
      const bad = await api.post('/api/v1/switch-auth/swt').set('Cookie', viewer).send({ password: 'wrong' });
      expect(bad.status).toBe(401);

      const ok = await api.post('/api/v1/switch-auth/swt').set('Cookie', viewer).send({ password: 'pw' });
      expect(ok.status).toBe(204);

      const status = await api.get('/api/v1/switch-auth/swt').set('Cookie', viewer);
      expect(status.body).toEqual({ connected: true });

      const del = await api.delete('/api/v1/switch-auth/swt').set('Cookie', viewer);
      expect(del.status).toBe(204);
      const off = await api.get('/api/v1/switch-auth/swt').set('Cookie', viewer);
      expect(off.body).toEqual({ connected: false });

      const missing = await api
        .post('/api/v1/switch-auth/nope')
        .set('Cookie', viewer)
        .send({ password: 'x' });
      expect(missing.status).toBe(404);

      // scoped role, ungrouped switch → 403; grouped → 204
      await pool.query(
        `INSERT INTO roles (id, display_name) VALUES ('scoped-test', 't') ON CONFLICT DO NOTHING`,
      );
      await pool.query(
        `INSERT INTO role_rules (role_id, method, path_prefix) VALUES ('scoped-test', 'GET', '/') ON CONFLICT DO NOTHING`,
      );
      await pool.query(
        `INSERT INTO role_groups (role_id, group_id) VALUES ('scoped-test', 'DC1-leaf') ON CONFLICT DO NOTHING`,
      );
      const scoped = await sessionCookie(pool, 'sw-scoped', { appRoles: ['scoped-test'] });
      expect(
        await api.post('/api/v1/switch-auth/swt').set('Cookie', scoped).send({ password: 'pw' }),
      ).toMatchObject({
        status: 403,
      });
      await pool.query(
        `INSERT INTO switch_groups (switch_id, group_id) VALUES ('swt', 'DC1-leaf') ON CONFLICT DO NOTHING`,
      );
      expect(
        await api.post('/api/v1/switch-auth/swt').set('Cookie', scoped).send({ password: 'pw' }),
      ).toMatchObject({
        status: 204,
      });
    } finally {
      dropUserTokens('sw-user');
      dropUserTokens('sw-scoped');
      await pool.query(`DELETE FROM user_roles WHERE user_sub IN ('sw-user', 'sw-scoped')`);
      await pool.query(`DELETE FROM sessions WHERE user_sub IN ('sw-user', 'sw-scoped')`);
      await pool.query(`DELETE FROM roles WHERE id = 'scoped-test'`);
      await pool.query('DELETE FROM switches WHERE id = $1', ['swt']);
      await pool.end();
      await app.close();
    }
  });

  it('TOFU: pinned live-TLS mint succeeds, wrong pin refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cumulus-tls-'));
    const key = join(dir, 'key.pem');
    const cert = join(dir, 'cert.pem');
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=127.0.0.1',
    ]);
    const fp = execFileSync('openssl', ['x509', '-in', cert, '-noout', '-fingerprint', '-sha256'], {
      encoding: 'utf8',
    });
    const pin = `SHA256:${fp.split('=')[1]?.replace(/:/g, '').trim()}`;
    const { readFileSync } = await import('node:fs');
    const pem = readFileSync(cert, 'utf8');

    let server: HttpsServer | null = null;
    try {
      server = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
        if (req.url === '/nvue_v1/api-token' && req.headers.authorization) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ token: 'live-jwt' }));
        } else {
          res.writeHead(401).end();
        }
      });
      await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as { port: number }).port;

      const app = await buildApp({ auth: { cfg: CFG } });
      await app.ready();
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const cookie = await sessionCookie(pool, 'sw-tls-user', { appRoles: ['viewer'] });
      try {
        await db().query(
          `INSERT INTO switches (id, display_name, base_url, cert_fingerprint, cert_pem) VALUES ('swtls', 't', $1, $2, $3)
           ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url, cert_fingerprint = EXCLUDED.cert_fingerprint, cert_pem = EXCLUDED.cert_pem`,
          [`https://127.0.0.1:${port}`, pin, pem],
        );
        const api = request(app.server);
        const ok = await api
          .post('/api/v1/switch-auth/swtls')
          .set('Cookie', cookie)
          .send({ password: 'whatever' });
        expect(ok.status).toBe(204);

        await db().query(`UPDATE switches SET cert_fingerprint = 'SHA256:00' WHERE id = 'swtls'`);
        await api.delete('/api/v1/switch-auth/swtls').set('Cookie', cookie);
        const refusedPin = await api
          .post('/api/v1/switch-auth/swtls')
          .set('Cookie', cookie)
          .send({ password: 'whatever' });
        expect(refusedPin.status).toBe(401);

        await db().query(`UPDATE switches SET cert_fingerprint = $1, cert_pem = 'bogus' WHERE id = 'swtls'`, [
          pin,
        ]);
        const refusedCa = await api
          .post('/api/v1/switch-auth/swtls')
          .set('Cookie', cookie)
          .send({ password: 'whatever' });
        expect(refusedCa.status).toBe(401);
      } finally {
        await db().query('DELETE FROM switches WHERE id = $1', ['swtls']);
        await pool.query(`DELETE FROM sessions WHERE user_sub = 'sw-tls-user'`);
        await pool.query(`DELETE FROM user_roles WHERE user_sub = 'sw-tls-user'`);
        await pool.end();
        await app.close();
      }
    } finally {
      await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    }
  });
});
