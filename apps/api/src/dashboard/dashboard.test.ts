/**
 * Personal dashboard prefs tests: defaults for new users, add/remove
 * persistence per user and per scope, unknown or misfit widgets rejected,
 * retired ids map forward.
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

  it('defaults, persists per user, rejects unknown widgets, maps retired ids', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const alice = await sessionCookie(pool, 'qd-alice');
    const bob = await sessionCookie(pool, 'qd-bob');
    const api = request(app.server);
    try {
      expect(await api.get('/api/v1/me/dashboard')).toMatchObject({ status: 401 });

      const ids = (r: { body: { widgets: Array<{ id: string }> } }) => r.body.widgets.map((w) => w.id);
      const fresh = await api.get('/api/v1/me/dashboard').set('Cookie', alice);
      expect(fresh.status).toBe(200);
      expect(ids(fresh)).toEqual([
        'fleet-stats',
        'health',
        'reachability',
        'cpu',
        'memory',
        'port-status',
        'traffic',
        'interface-errors',
        'top-talkers',
        'environment',
        'software',
        'recent-activity',
      ]);
      // Hidden widgets are offered by the picker, never placed by default.
      expect(fresh.body.available).toContain('unsaved-config');
      expect(fresh.body.available).not.toContain('connection');

      const saved = await api
        .put('/api/v1/me/dashboard')
        .set('Cookie', alice)
        .send({ widgets: [{ id: 'recent-activity' }, { id: 'bgp-sessions' }] });
      expect(saved.status).toBe(200);
      expect(ids(saved)).toEqual(['recent-activity', 'bgp-sessions']);
      expect(ids(await api.get('/api/v1/me/dashboard').set('Cookie', alice))).toEqual([
        'recent-activity',
        'bgp-sessions',
      ]);

      // Each dashboard kind keeps its own layout and catalog.
      const sw = await api.get('/api/v1/me/dashboard?scope=switch').set('Cookie', alice);
      expect(ids(sw)).toContain('connection');
      expect(sw.body.available).not.toContain('members');
      const swSaved = await api
        .put('/api/v1/me/dashboard?scope=switch')
        .set('Cookie', alice)
        .send({ widgets: [{ id: 'connection' }, { id: 'cpu' }] });
      expect(ids(swSaved)).toEqual(['connection', 'cpu']);
      expect(ids(await api.get('/api/v1/me/dashboard').set('Cookie', alice))).toEqual([
        'recent-activity',
        'bgp-sessions',
      ]);
      expect(ids(await api.get('/api/v1/me/dashboard?scope=group').set('Cookie', alice))).toContain(
        'members',
      );
      const misfit = await api
        .put('/api/v1/me/dashboard?scope=fleet')
        .set('Cookie', alice)
        .send({ widgets: [{ id: 'connection' }] });
      expect(misfit.status).toBe(400);
      expect((await api.get('/api/v1/me/dashboard?scope=nope').set('Cookie', alice)).status).toBe(400);

      expect(ids(await api.get('/api/v1/me/dashboard').set('Cookie', bob))).toHaveLength(12);

      const bad = await api
        .put('/api/v1/me/dashboard')
        .set('Cookie', alice)
        .send({ widgets: [{ id: 'packets' }] });
      expect(bad.status).toBe(400);

      const empty = await api.put('/api/v1/me/dashboard').set('Cookie', alice).send({ widgets: [] });
      expect(empty.status).toBe(200);
      expect(empty.body.widgets).toHaveLength(12);

      // Retired ids map forward in place; the old CPU & memory card splits in two.
      await pool.query(
        `INSERT INTO user_dashboard_widgets (user_sub, scope, widgets, seen) VALUES ('qd-bob', 'fleet', $1::jsonb, $2)
         ON CONFLICT (user_sub, scope) DO UPDATE SET widgets = EXCLUDED.widgets, seen = EXCLUDED.seen`,
        [
          JSON.stringify([
            { id: 'fleet-health' },
            { id: 'resources' },
            { id: 'needs-attention' },
            { id: 'nope' },
          ]),
          [
            'fleet-stats',
            'health',
            'reachability',
            'resources',
            'port-status',
            'traffic',
            'interface-errors',
            'top-talkers',
            'environment',
            'software',
            'recent-activity',
          ],
        ],
      );
      expect(ids(await api.get('/api/v1/me/dashboard').set('Cookie', bob))).toEqual([
        'fleet-stats',
        'cpu',
        'memory',
      ]);

      // A save from before new widgets shipped: unseen defaults join once, after the user's own.
      await pool.query(`UPDATE user_dashboard_widgets SET seen = $1 WHERE user_sub = 'qd-bob'`, [
        ['fleet-stats', 'reachability', 'traffic'],
      ]);
      expect(ids(await api.get('/api/v1/me/dashboard').set('Cookie', bob))).toEqual([
        'fleet-stats',
        'cpu',
        'memory',
        'health',
        'port-status',
        'interface-errors',
        'top-talkers',
        'environment',
        'software',
        'recent-activity',
      ]);
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
