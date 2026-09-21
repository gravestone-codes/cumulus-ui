/**
 * Personal dashboard prefs tests: defaults for new users, add/remove
 * persistence per user, unknown widgets rejected, auth required.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { Pool, type Pool as PoolType } from 'pg';
import { buildApp } from '../app.js';
import { migrate } from '../db.js';
import { type AuthConfig } from '../auth/config.js';
import { sessionCookie } from '../test-sessions.js';

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
if (!LIVE) console.warn('dashboard tests skipped: DATABASE_URL unreachable');

describe.skipIf(!LIVE)('personal dashboard prefs', () => {
  let pool: PoolType;

  beforeAll(async () => {
    await migrate();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  it('defaults, persists per user, rejects unknown widgets', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const alice = await sessionCookie(pool, 'qd-alice');
    const bob = await sessionCookie(pool, 'qd-bob');
    const api = request(app.server);
    try {
      expect(await api.get('/api/v1/me/dashboard')).toMatchObject({ status: 401 });

      const fresh = await api.get('/api/v1/me/dashboard').set('Cookie', alice);
      expect(fresh.status).toBe(200);
      expect(fresh.body.widgets.map((w: { id: string }) => w.id)).toEqual([
        'fleet-health',
        'needs-attention',
        'recent-activity',
      ]);

      const saved = await api
        .put('/api/v1/me/dashboard')
        .set('Cookie', alice)
        .send({ widgets: [{ id: 'recent-activity' }] });
      expect(saved.status).toBe(200);
      expect(saved.body.widgets).toEqual([{ id: 'recent-activity' }]);

      const reread = await api.get('/api/v1/me/dashboard').set('Cookie', alice);
      expect(reread.body.widgets).toEqual([{ id: 'recent-activity' }]);

      const bobPrefs = await api.get('/api/v1/me/dashboard').set('Cookie', bob);
      expect(bobPrefs.body.widgets).toHaveLength(3);

      const bad = await api
        .put('/api/v1/me/dashboard')
        .set('Cookie', alice)
        .send({ widgets: [{ id: 'packets' }] });
      expect(bad.status).toBe(400);

      const empty = await api.put('/api/v1/me/dashboard').set('Cookie', alice).send({ widgets: [] });
      expect(empty.status).toBe(200);
      expect(empty.body.widgets).toHaveLength(3);
    } finally {
      await pool.query(`DELETE FROM sessions WHERE user_sub IN ('qd-alice', 'qd-bob')`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub IN ('qd-alice', 'qd-bob')`);
      await pool.query(`DELETE FROM user_dashboard_widgets WHERE user_sub IN ('qd-alice', 'qd-bob')`);
      await pool.query(`DELETE FROM users WHERE id IN ('qd-alice', 'qd-bob')`);
      await pool.end();
      await app.close();
    }
  });
});
