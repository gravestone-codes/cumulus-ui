/**
 * Audit tests (roadmap 0.9). Chain integrity incl. parallel writers and
 * tamper detection; read endpoint gated through PermissionGate.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool, type Pool as PoolType } from 'pg';
import { buildApp } from './app.js';
import { sessionCookie } from './test-sessions.js';
import { migrate } from './db.js';
import { type AuthConfig } from './auth/config.js';
import { audit, purgeAudit, redact, verifyChain } from './audit/store.js';
import { stableStringify } from './lib/json.js';

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
if (!LIVE) console.warn('audit tests skipped: DATABASE_URL unreachable');

describe('redact (pure)', () => {
  it('masks secret-bearing keys recursively, leaves the rest', () => {
    expect(
      redact({
        user: 'op',
        password: 'x',
        nested: { api_key: 'y', list: [{ token: 'z' }, 1] },
        community: 'c',
      }),
    ).toEqual({
      user: 'op',
      password: '[redacted]',
      nested: { api_key: '[redacted]', list: [{ token: '[redacted]' }, 1] },
      community: '[redacted]',
    });
    expect(redact('plain')).toBe('plain');
    expect(redact(null)).toBe(null);
  });
});

describe('stableStringify (pure)', () => {
  it('ignores key order at every level', () => {
    expect(stableStringify({ b: 1, a: { z: 1, y: 2 } })).toBe(stableStringify({ a: { y: 2, z: 1 }, b: 1 }));
  });
});

describe.skipIf(!LIVE)('audit trail', () => {
  let pool: PoolType;

  beforeAll(async () => {
    await migrate();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('appends a verifiable chain, even under parallel writers', async () => {
    const before = await verifyChain();
    await audit({
      userSub: 'u1',
      username: 'u1',
      roles: ['net-admin'],
      method: 'PATCH',
      path: '/interface/swp1',
    });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        audit({ userSub: 'u1', username: 'u1', roles: [], method: 'GET', path: `/interface/swp${i}` }),
      ),
    );
    const report = await verifyChain();
    expect(report.ok).toBe(true);
    expect(report.checked).toBeGreaterThanOrEqual(before.checked + 11);
  });

  it('detects tampering at the exact row', async () => {
    const id = await audit({ userSub: 'u2', username: 'u2', roles: [], method: 'GET', path: '/tamper-me' });
    try {
      await pool.query(`UPDATE audit_log SET path = '/evil' WHERE id = $1`, [id]);
      const report = await verifyChain();
      expect(report.ok).toBe(false);
      expect(report.badId).toBe(id);
    } finally {
      // A failed assertion here must not leave a poisoned row behind.
      await pool.query('DELETE FROM audit_log WHERE id = $1', [id]);
    }
  });

  it('purges only rows past retention', async () => {
    const id = await audit({ userSub: 'u', username: 'u', roles: [], method: 'GET', path: '/purge-me' });
    await pool.query(`UPDATE audit_log SET ts = now() - interval '100 days' WHERE id = $1`, [id]);
    expect(await purgeAudit(90)).toBeGreaterThan(0);
    const { rows } = await pool.query<{ id: number }>('SELECT id FROM audit_log WHERE id = $1', [id]);
    expect(rows.length).toBe(0);
    expect(await purgeAudit(90)).toBe(0);
  });

  it('read endpoint: auditor in, viewer out, anonymous out', async () => {
    await audit({
      userSub: 'aud',
      username: 'aud',
      roles: ['auditor'],
      method: 'PATCH',
      path: '/interface/s1',
    });
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    try {
      const api = request(app.server);
      const auditor = await sessionCookie(pool, 'aud1', { appRoles: [] });
      await pool.query(`INSERT INTO user_roles (user_sub, role_id) VALUES ('aud1', 'auditor')`);
      const ok = await api.get('/api/v1/audit?limit=5').set('Cookie', auditor);
      expect(ok.status).toBe(200);
      expect(Array.isArray(ok.body)).toBe(true);

      const viewer = await sessionCookie(pool, 'view1', { appRoles: [] });
      await pool.query(`INSERT INTO user_roles (user_sub, role_id) VALUES ('view1', 'viewer')`);
      expect(await api.get('/api/v1/audit').set('Cookie', viewer)).toMatchObject({ status: 403 });
      expect(await api.get('/api/v1/audit')).toMatchObject({ status: 401 });

      await pool.query(`DELETE FROM user_roles WHERE user_sub IN ('aud1', 'view1')`);
      await pool.query(`DELETE FROM sessions WHERE user_sub IN ('aud1', 'view1')`);
      // NOTE: never mass-delete audit_log here — other files' tests run in
      // parallel against the same DB and count on their rows surviving.
    } finally {
      await app.close();
    }
  });
});
