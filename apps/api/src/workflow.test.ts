/**
 * Workflow tests (roadmap 1.1): branch lifecycle + staging against a fake NVUE
 * that speaks our assumed revision protocol (revisions.ts documents the risk).
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool, type Pool as PoolType } from 'pg';
import { buildApp } from './app.js';
import { migrate, db } from './db.js';
import { type AuthConfig } from './auth/config.js';
import { sessionCookie } from './test-sessions.js';
import { setSwitchToken, dropUserTokens } from './switchauth/sessions.js';
import { getEditSession } from './workflow/branches.js';
import { json, startFakeNvue, type FakeNvue } from './test-nvue.js';

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
if (!LIVE) console.warn('workflow tests skipped: DATABASE_URL unreachable');

describe.skipIf(!LIVE)('branches + staging', () => {
  let pool: PoolType;

  afterAll(async () => {
    await pool.end();
  });
  let fake: FakeNvue;
  let counter = 0;
  const nvueState = {
    iface: { state: 'up', description: 'old' } as Record<string, unknown>,
    jobs: {} as Record<string, string[]>,
  };

  beforeAll(async () => {
    await migrate();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    fake = await startFakeNvue((req, res) => {
      const url = new URL(req.url ?? '/', 'https://x');
      if (req.method === 'POST' && url.pathname === '/nvue_v1/revision') {
        json(res, 201, { rev: `N${++counter}` });
      } else if (
        req.method === 'GET' &&
        url.pathname === '/nvue_v1/interface/swp1' &&
        !url.searchParams.has('rev')
      ) {
        json(res, 200, nvueState.iface);
      } else if (req.method === 'PATCH' && url.pathname === '/nvue_v1/interface/swp1') {
        json(res, 200, {});
      } else if (req.method === 'PATCH' && url.pathname.startsWith('/nvue_v1/revision/')) {
        const job = `J${++counter}`;
        nvueState.jobs[job] = ['running', 'success'];
        json(res, 200, { job });
      } else if (req.method === 'POST' && url.pathname === '/nvue_v1/interface/swp1/counters') {
        nvueState.jobs['JA'] = ['running', 'success'];
        json(res, 200, { job: 'JA' });
      } else if (req.method === 'GET' && url.pathname.startsWith('/nvue_v1/action/')) {
        const job = url.pathname.split('/').pop() ?? '';
        const queue = nvueState.jobs[job] ?? ['running'];
        const state = queue.length > 1 ? queue.shift() : queue[0];
        json(res, 200, { id: job, state });
      } else if (req.method === 'DELETE' && url.pathname.startsWith('/nvue_v1/revision/')) {
        json(res, 200, {});
      } else {
        json(res, 404, { message: 'nope' });
      }
    });
    await db().query(
      `INSERT INTO switches (id, display_name, base_url, cert_fingerprint, cert_pem) VALUES ('swf', 't', $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url, cert_fingerprint = EXCLUDED.cert_fingerprint, cert_pem = EXCLUDED.cert_pem`,
      [fake.baseUrl, fake.pin, fake.caPem],
    );
  });

  it('open → stage → 409 → discard → reopen', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const cookie = await sessionCookie(pool, 'wf-user', { appRoles: ['net-operator'] });
    setSwitchToken('wf-user', 'swf', 'stub-jwt');
    const api = request(app.server);
    try {
      const opened = await api.post('/api/v1/switches/swf/branch').set('Cookie', cookie);
      expect(opened.status).toBe(200);
      expect(opened.body.branch).toBe('N1');
      expect(
        fake.hits.some((h) => h.includes('POST /nvue_v1/revision') && h.includes('base_rev=applied')),
      ).toBe(true);

      const staged = await api
        .post('/api/v1/switches/swf/stage')
        .set('Cookie', cookie)
        .send({ path: '/interface/swp1', method: 'PATCH', body: { description: 'new' } });
      expect(staged.status).toBe(200);
      expect(fake.hits.some((h) => h.includes('PATCH /nvue_v1/interface/swp1') && h.includes('rev=N1'))).toBe(
        true,
      );
      const session = await getEditSession('wf-user', 'swf');
      expect(session?.staged).toEqual([
        {
          path: '/interface/swp1',
          method: 'PATCH',
          before: { state: 'up', description: 'old' },
          after: { description: 'new' },
        },
      ]);

      expect(await api.post('/api/v1/switches/swf/branch').set('Cookie', cookie)).toMatchObject({
        status: 409,
      });

      const dropped = await api.delete('/api/v1/switches/swf/branch').set('Cookie', cookie);
      expect(dropped.body).toEqual({ switchDiscarded: true });

      const reopened = await api.post('/api/v1/switches/swf/branch').set('Cookie', cookie);
      expect(reopened.body.branch).toBe('N2');
      await api.delete('/api/v1/switches/swf/branch').set('Cookie', cookie);
    } finally {
      dropUserTokens('wf-user');
      await pool.query(`DELETE FROM sessions WHERE user_sub = 'wf-user'`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub = 'wf-user'`);
      await pool.query('DELETE FROM edit_sessions WHERE user_sub = $1', ['wf-user']);
      await app.close();
    }
  });

  it('staging without rights or branch is refused', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const viewer = await sessionCookie(pool, 'wf-viewer', { appRoles: ['viewer'] });
    const api = request(app.server);
    try {
      expect(
        await api.post('/api/v1/switches/swf/stage').send({ path: '/interface/swp1', method: 'PATCH' }),
      ).toMatchObject({
        status: 401,
      });
      expect(
        await api
          .post('/api/v1/switches/swf/stage')
          .set('Cookie', viewer)
          .send({ path: '/interface/swp1', method: 'PATCH' }),
      ).toMatchObject({ status: 403 });
      const op = await sessionCookie(pool, 'wf-op', { appRoles: ['net-operator'] });
      setSwitchToken('wf-op', 'swf', 'stub-jwt');
      expect(
        await api
          .post('/api/v1/switches/swf/stage')
          .set('Cookie', op)
          .send({ path: '/interface/swp1', method: 'PATCH' }),
      ).toMatchObject({ status: 409 });
      dropUserTokens('wf-op');
      await pool.query(`DELETE FROM sessions WHERE user_sub IN ('wf-viewer', 'wf-op')`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub IN ('wf-viewer', 'wf-op')`);
    } finally {
      await app.close();
    }
  });

  it('presence: heartbeat visible to others, stale ignored', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const alice = await sessionCookie(pool, 'wf-alice', { appRoles: ['net-operator'] });
    const bob = await sessionCookie(pool, 'wf-bob', { appRoles: ['net-operator'] });
    const api = request(app.server);
    try {
      await api.post('/api/v1/switches/swf/presence').set('Cookie', alice).send({ path: '/interface/swp1' });
      await api.post('/api/v1/switches/swf/presence').set('Cookie', bob).send({ path: '/interface/swp1' });
      const seenByAlice = await api.get('/api/v1/switches/swf/presence').set('Cookie', alice);
      expect(seenByAlice.body.map((e: { userSub: string }) => e.userSub)).toEqual(['wf-bob']);
      const seenByBob = await api.get('/api/v1/switches/swf/presence').set('Cookie', bob);
      expect(seenByBob.body.map((e: { userSub: string }) => e.userSub)).toEqual(['wf-alice']);

      await pool.query(
        `UPDATE presence SET updated_at = now() - interval '5 minutes' WHERE user_sub = 'wf-bob'`,
      );
      const afterStale = await api.get('/api/v1/switches/swf/presence').set('Cookie', alice);
      expect(afterStale.body).toEqual([]);
    } finally {
      await pool.query(`DELETE FROM presence WHERE user_sub IN ('wf-alice', 'wf-bob')`);
      await pool.query(`DELETE FROM sessions WHERE user_sub IN ('wf-alice', 'wf-bob')`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub IN ('wf-alice', 'wf-bob')`);
      await app.close();
    }
  });

  it('apply: happy path writes audit and clears the session', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const cookie = await sessionCookie(pool, 'wf-apply1', { appRoles: ['net-admin'] });
    setSwitchToken('wf-apply1', 'swf', 'stub-jwt');
    nvueState.iface = { state: 'up', description: 'old' };
    const api = request(app.server);
    try {
      expect((await api.post('/api/v1/switches/swf/branch').set('Cookie', cookie)).status).toBe(200);
      expect(
        (
          await api
            .post('/api/v1/switches/swf/stage')
            .set('Cookie', cookie)
            .send({ path: '/interface/swp1', method: 'PATCH', body: { description: 'new' } })
        ).status,
      ).toBe(200);
      const applied = await api.post('/api/v1/switches/swf/apply').set('Cookie', cookie);
      expect(applied.status).toBe(200);
      expect(applied.body.applied).toBe(true);
      expect(applied.body.paths).toEqual(['/interface/swp1']);
      expect(typeof applied.body.jobId).toBe('string');
      expect(fake.hits.some((h) => h.includes('PATCH /nvue_v1/revision/'))).toBe(true);
      expect(await getEditSession('wf-apply1', 'swf')).toBeNull();
      const { rows } = await pool.query<{ id: number }>(
        `SELECT id FROM audit_log WHERE user_sub = 'wf-apply1' AND path LIKE '%/apply'`,
      );
      expect(rows.length).toBe(1);
    } finally {
      dropUserTokens('wf-apply1');
      await pool.query(`DELETE FROM sessions WHERE user_sub = 'wf-apply1'`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub = 'wf-apply1'`);
      await pool.query(`DELETE FROM edit_sessions WHERE user_sub = 'wf-apply1'`);
      await pool.query(`DELETE FROM audit_log WHERE user_sub = 'wf-apply1'`);
      await app.close();
    }
  });

  it('apply: operator without /config is refused; empty session conflicts', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const cookie = await sessionCookie(pool, 'wf-apply2', { appRoles: ['net-operator'] });
    setSwitchToken('wf-apply2', 'swf', 'stub-jwt');
    const api = request(app.server);
    try {
      expect(await api.post('/api/v1/switches/swf/apply').set('Cookie', cookie)).toMatchObject({
        status: 403,
      });
      const admin = await sessionCookie(pool, 'wf-apply2b', { appRoles: ['net-admin'] });
      setSwitchToken('wf-apply2b', 'swf', 'stub-jwt');
      expect(await api.post('/api/v1/switches/swf/apply').set('Cookie', admin)).toMatchObject({
        status: 409,
      });
    } finally {
      dropUserTokens('wf-apply2');
      dropUserTokens('wf-apply2b');
      await pool.query(`DELETE FROM sessions WHERE user_sub IN ('wf-apply2', 'wf-apply2b')`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub IN ('wf-apply2', 'wf-apply2b')`);
      await app.close();
    }
  });

  it('apply: external change conflicts with mine/theirs/current; identical change wins', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const cookie = await sessionCookie(pool, 'wf-apply3', { appRoles: ['net-admin'] });
    setSwitchToken('wf-apply3', 'swf', 'stub-jwt');
    nvueState.iface = { state: 'up', description: 'old' };
    const api = request(app.server);
    try {
      await api.post('/api/v1/switches/swf/branch').set('Cookie', cookie);
      await api
        .post('/api/v1/switches/swf/stage')
        .set('Cookie', cookie)
        .send({ path: '/interface/swp1', method: 'PATCH', body: { description: 'new' } });
      nvueState.iface = { state: 'up', description: 'theirs' };
      const conflicted = await api.post('/api/v1/switches/swf/apply').set('Cookie', cookie);
      expect(conflicted.status).toBe(409);
      expect(conflicted.body.conflicts).toEqual([
        {
          path: '/interface/swp1',
          method: 'PATCH',
          before: { state: 'up', description: 'old' },
          mine: { description: 'new' },
          current: { state: 'up', description: 'theirs' },
        },
      ]);
      nvueState.iface = { description: 'new' };
      const won = await api.post('/api/v1/switches/swf/apply').set('Cookie', cookie);
      expect(won.status).toBe(200);
      expect(won.body.applied).toBe(true);
    } finally {
      dropUserTokens('wf-apply3');
      await pool.query(`DELETE FROM sessions WHERE user_sub = 'wf-apply3'`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub = 'wf-apply3'`);
      await pool.query(`DELETE FROM edit_sessions WHERE user_sub = 'wf-apply3'`);
      await app.close();
    }
  });

  it('pollJob: failure and timeout surface as errors', async () => {
    setSwitchToken('wf-poll', 'swf', 'stub-jwt');
    nvueState.jobs['JF'] = ['running', 'failed'];
    nvueState.jobs['JH'] = ['running'];
    const { pollJob } = await import('./workflow/apply.js');
    await expect(pollJob('wf-poll', 'swf', 'JF', { intervalMs: 5, timeoutMs: 500 })).rejects.toThrow(
      /failed/,
    );
    await expect(pollJob('wf-poll', 'swf', 'JH', { intervalMs: 5, timeoutMs: 120 })).rejects.toThrow(
      /did not finish/,
    );
    dropUserTokens('wf-poll');
  });

  it('diff: clean, then conflict with three values', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const cookie = await sessionCookie(pool, 'wf-diff', { appRoles: ['net-admin'] });
    setSwitchToken('wf-diff', 'swf', 'stub-jwt');
    nvueState.iface = { state: 'up', description: 'old' };
    const api = request(app.server);
    try {
      await api.post('/api/v1/switches/swf/branch').set('Cookie', cookie);
      await api
        .post('/api/v1/switches/swf/stage')
        .set('Cookie', cookie)
        .send({ path: '/interface/swp1', method: 'PATCH', body: { description: 'new' } });
      const clean = await api.get('/api/v1/switches/swf/diff').set('Cookie', cookie);
      expect(clean.status).toBe(200);
      expect(clean.body.diffs).toEqual([
        {
          path: '/interface/swp1',
          method: 'PATCH',
          before: { state: 'up', description: 'old' },
          mine: { description: 'new' },
          current: { state: 'up', description: 'old' },
          state: 'clean',
        },
      ]);
      nvueState.iface = { state: 'up', description: 'theirs' };
      const conflicted = await api.get('/api/v1/switches/swf/diff').set('Cookie', cookie);
      expect(conflicted.body.diffs[0].state).toBe('conflict');
      expect(conflicted.body.diffs[0].current).toEqual({ state: 'up', description: 'theirs' });
      nvueState.iface = { state: 'up', description: 'old' };
    } finally {
      dropUserTokens('wf-diff');
      await pool.query(`DELETE FROM sessions WHERE user_sub = 'wf-diff'`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub = 'wf-diff'`);
      await pool.query(`DELETE FROM edit_sessions WHERE user_sub = 'wf-diff'`);
      await app.close();
    }
  });

  it('fanout: mirrored stage, partial apply without sibling rollback', async () => {
    const fakeB = await startFakeNvue((req, res) => {
      const url = new URL(req.url ?? '/', 'https://x');
      if (req.method === 'POST' && url.pathname === '/nvue_v1/revision') json(res, 201, { rev: 'NB1' });
      else if (
        req.method === 'GET' &&
        url.pathname === '/nvue_v1/interface/swp1' &&
        !url.searchParams.has('rev')
      ) {
        json(res, 200, { state: 'up' });
      } else if (req.method === 'PATCH' && url.pathname === '/nvue_v1/interface/swp1') json(res, 200, {});
      else if (req.method === 'PATCH' && url.pathname.startsWith('/nvue_v1/revision/')) {
        json(res, 500, { message: 'boom' });
      } else json(res, 404, { message: 'nope' });
    });
    await db().query(
      `INSERT INTO switches (id, display_name, base_url, cert_fingerprint, cert_pem) VALUES
       ('swA', 't', $1, $2, $3), ('swB', 't', $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url, cert_fingerprint = EXCLUDED.cert_fingerprint, cert_pem = EXCLUDED.cert_pem`,
      [fake.baseUrl, fake.pin, fake.caPem, fakeB.baseUrl, fakeB.pin, fakeB.caPem],
    );
    await pool.query(`INSERT INTO groups (id, display_name) VALUES ('G1', 't') ON CONFLICT DO NOTHING`);
    await pool.query(
      `INSERT INTO switch_groups (switch_id, group_id) VALUES ('swA', 'G1'), ('swB', 'G1') ON CONFLICT DO NOTHING`,
    );
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const cookie = await sessionCookie(pool, 'wf-fan', { appRoles: ['net-admin'] });
    setSwitchToken('wf-fan', 'swA', 'stub-jwt');
    setSwitchToken('wf-fan', 'swB', 'stub-jwt');
    const api = request(app.server);
    try {
      const staged = await api
        .post('/api/v1/groups/G1/stage')
        .set('Cookie', cookie)
        .send({ path: '/interface/swp1', method: 'PATCH', body: { description: 'mirrored' } });
      expect(staged.status).toBe(200);
      expect(staged.body.results).toEqual([
        { switchId: 'swA', ok: true, branch: expect.any(String) },
        { switchId: 'swB', ok: true, branch: 'NB1' },
      ]);
      const applied = await api.post('/api/v1/groups/G1/apply').set('Cookie', cookie);
      expect(applied.status).toBe(200);
      const byId = Object.fromEntries(applied.body.results.map((r: { switchId: string }) => [r.switchId, r]));
      expect(byId.swA.ok).toBe(true);
      expect(byId.swB.ok).toBe(false);
      expect(await getEditSession('wf-fan', 'swA')).toBeNull();
      expect(await getEditSession('wf-fan', 'swB')).not.toBeNull();

      const op = await sessionCookie(pool, 'wf-fan-op', { appRoles: ['net-operator'] });
      const denied = await api.post('/api/v1/groups/G1/apply').set('Cookie', op);
      expect(denied.body.results.every((r: { ok: boolean }) => r.ok === false)).toBe(true);
    } finally {
      dropUserTokens('wf-fan');
      await pool.query(`DELETE FROM sessions WHERE user_sub IN ('wf-fan', 'wf-fan-op')`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub IN ('wf-fan', 'wf-fan-op')`);
      await pool.query(`DELETE FROM edit_sessions WHERE user_sub IN ('wf-fan', 'wf-fan-op')`);
      await pool.query(`DELETE FROM switch_groups WHERE switch_id IN ('swA', 'swB')`);
      await pool.query(`DELETE FROM switches WHERE id IN ('swA', 'swB')`);
      await pool.query(`DELETE FROM groups WHERE id = 'G1'`);
      await fakeB.close();
      await app.close();
    }
  });

  it('action runner: runs, tracks job, refuses by role and manifest', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const op = await sessionCookie(pool, 'wf-act', { appRoles: ['net-operator'] });
    setSwitchToken('wf-act', 'swf', 'stub-jwt');
    const api = request(app.server);
    try {
      const ran = await api
        .post('/api/v1/switches/swf/action')
        .set('Cookie', op)
        .send({ path: '/interface/swp1/counters' });
      expect(ran.status).toBe(200);
      expect(ran.body.jobId).toBe('JA');
      expect(ran.body.finalState).toBe('success');
      expect(ran.body.dangerous).toBe(false);

      const viewer = await sessionCookie(pool, 'wf-act-v', { appRoles: ['viewer'] });
      setSwitchToken('wf-act-v', 'swf', 'stub-jwt');
      expect(
        await api
          .post('/api/v1/switches/swf/action')
          .set('Cookie', viewer)
          .send({ path: '/interface/swp1/counters' }),
      ).toMatchObject({ status: 403 });

      expect(
        await api.post('/api/v1/switches/swf/action').set('Cookie', op).send({ path: '/system/image' }),
      ).toMatchObject({ status: 403 });

      expect(
        await api.post('/api/v1/switches/swf/action').set('Cookie', op).send({ path: '/nope' }),
      ).toMatchObject({ status: 403 });

      const admin = await sessionCookie(pool, 'wf-act-a', { appRoles: ['sys-admin'] });
      setSwitchToken('wf-act-a', 'swf', 'stub-jwt');
      expect(
        await api.post('/api/v1/switches/swf/action').set('Cookie', admin).send({ path: '/nope' }),
      ).toMatchObject({ status: 400 });
    } finally {
      dropUserTokens('wf-act');
      dropUserTokens('wf-act-v');
      dropUserTokens('wf-act-a');
      await pool.query(`DELETE FROM sessions WHERE user_sub IN ('wf-act', 'wf-act-v', 'wf-act-a')`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub IN ('wf-act', 'wf-act-v', 'wf-act-a')`);
      await app.close();
    }
  });
});
