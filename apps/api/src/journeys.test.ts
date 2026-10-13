/**
 * Journey API tests: catalog with per-role locks, start/resume, input
 * validation, server-side checks against a fake switch (pass, branch, block),
 * the plan a change step hands the UI, the closing audit entry, and the
 * deny cases (anonymous, another user's run, a role without the read).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { Pool, type Pool as PoolType } from 'pg';
import { buildApp } from './app.js';
import { migrate, db } from './db.js';
import { type AuthConfig } from './auth/config.js';
import { sessionCookie } from './test-sessions.js';
import { setSwitchToken, dropUserTokens } from './switchauth/sessions.js';
import { startFakeNvue, json } from './test-nvue.js';

const CFG: AuthConfig = { credKey: 'test-cred-key-long-enough-12345', idleMinutes: 30 };
const USERS = ['qj-op', 'qj-viewer', 'qj-none', 'qj-other'];

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
if (!LIVE) console.warn('journey tests skipped: DATABASE_URL unreachable');

describe.skipIf(!LIVE)('journeys', () => {
  let pool: PoolType;

  beforeAll(async () => {
    await migrate();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  it('runs the route-leak journey end to end on evidence, then audits it', async () => {
    // The fake switch leaks 10.20.0.0/16 from BLUE into RED until the import goes away.
    let leaking = true;
    const fake = await startFakeNvue((req, res) => {
      const url = new URL(req.url ?? '/', 'https://x');
      const path = url.pathname.replace(/^\/nvue_v1/, '');
      if (path === '/vrf/RED/router/rib/ipv4/route/10.20.0.0%2F16') {
        if (!leaking) return json(res, 404, { message: 'not found' });
        return json(res, 200, {
          'route-entry': { '1': { protocol: 'bgp', 'via-entry': { '10.0.0.1': { vrf: 'BLUE' } } } },
        });
      }
      if (path === '/vrf/RED/router/bgp/address-family/ipv4-unicast/route-import/from-vrf') {
        return json(res, 200, { enable: 'on', list: leaking ? { BLUE: {} } : {} });
      }
      return json(res, 404, { message: 'nope' });
    });
    await db().query(
      `INSERT INTO switches (id, display_name, base_url, cert_fingerprint, cert_pem) VALUES ('swj', 't', $1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url, cert_fingerprint = EXCLUDED.cert_fingerprint, cert_pem = EXCLUDED.cert_pem`,
      [fake.baseUrl, fake.pin, fake.caPem],
    );
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const op = await sessionCookie(pool, 'qj-op', { appRoles: ['net-operator'] });
    const viewer = await sessionCookie(pool, 'qj-viewer', { appRoles: ['viewer'] });
    const other = await sessionCookie(pool, 'qj-other', { appRoles: ['net-operator'] });
    await pool.query(
      `INSERT INTO roles (id, display_name, description) VALUES ('qj-empty', 'No grants', '') ON CONFLICT (id) DO NOTHING`,
    );
    const none = await sessionCookie(pool, 'qj-none', { appRoles: ['qj-empty'] });
    for (const u of USERS) setSwitchToken(u, 'swj', 'stub-jwt');
    const api = request(app.server);
    const scope = { kind: 'switch', id: 'swj' };
    const step = (id: string, s: string, body: object, cookie = op) =>
      api.post(`/api/v1/me/journeys/${id}/steps/${s}`).set('Cookie', cookie).send(body);
    try {
      expect(await api.get('/api/v1/journeys').query(scope)).toMatchObject({ status: 401 });
      expect(await api.get('/api/v1/me/journeys')).toMatchObject({ status: 401 });

      // Catalog: the operator may run everything; a viewer sees writes locked with the reason.
      const lockOf = (r: request.Response, key: string) =>
        (r.body.journeys as Array<{ key: string; locked: string | null }>).find((j) => j.key === key)?.locked;
      const opCat = await api.get('/api/v1/journeys').set('Cookie', op).query(scope);
      expect(opCat.status).toBe(200);
      expect(lockOf(opCat, 'route-leak')).toBeNull();
      const viewCat = await api.get('/api/v1/journeys').set('Cookie', viewer).query(scope);
      expect(lockOf(viewCat, 'route-leak')).toMatch(/not granted/);
      expect(
        (await api.get('/api/v1/journeys').set('Cookie', op).query({ kind: 'switch', id: 'nope' })).status,
      ).toBe(404);

      // Start, then start again: the same run resumes.
      const started = await api
        .post('/api/v1/me/journeys')
        .set('Cookie', op)
        .send({ journey: 'route-leak', scope });
      expect(started.status).toBe(201);
      const id = started.body.id as string;
      expect(started.body.current).toBe('leak');
      const again = await api
        .post('/api/v1/me/journeys')
        .set('Cookie', op)
        .send({ journey: 'route-leak', scope });
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(id);

      // Inputs: per-field problems, then accepted (prefix normalised to its network).
      const bad = await step(id, 'leak', { op: 'submit', values: { vrf: 'RED', prefix: '10.20.0.0/40' } });
      expect(bad.status).toBe(400);
      expect(Object.keys(bad.body.errors)).toEqual(['prefix']);
      expect((await step(id, 'present', { op: 'verify' })).status).toBe(409);
      const took = await step(id, 'leak', { op: 'submit', values: { vrf: 'RED', prefix: '10.20.1.9/16' } });
      expect(took.body).toMatchObject({ current: 'present', values: { 'leak.net': '10.20.0.0/16' } });

      // Checks are reads on the switch: present → exporter (captures BLUE) → import policy.
      expect((await step(id, 'present', { op: 'verify' })).body.current).toBe('exporter');
      const exporter = await step(id, 'exporter', { op: 'verify' });
      expect(exporter.body).toMatchObject({ current: 'import', values: { 'exporter.source': 'BLUE' } });
      expect((await step(id, 'import', { op: 'verify' })).body.current).toBe('fix');

      // The fix: the change step hands the UI the exact write ChangeFlow will stage.
      expect((await step(id, 'fix', { op: 'submit', values: { remedy: 'route-map' } })).body.errors).toEqual({
        routemap: 'Required.',
      });
      const fix = await step(id, 'fix', { op: 'submit', values: { remedy: 'remove-import' } });
      expect(fix.body.current).toBe('unimport');
      expect(fix.body.plan).toEqual([
        {
          method: 'DELETE',
          path: '/vrf/RED/router/bgp/address-family/ipv4-unicast/route-import/from-vrf/list/BLUE',
        },
      ]);

      // Not applied yet: the gate blocks with evidence. Applied (fake flips): it passes.
      const early = await step(id, 'unimport', { op: 'verify' });
      expect(early.body).toMatchObject({ state: 'blocked', current: 'unimport' });
      expect(early.body.steps.unimport.evidence[0].ok).toBe(false);
      leaking = false;
      expect((await step(id, 'unimport', { op: 'verify' })).body).toMatchObject({
        state: 'in-progress',
        current: 'gone',
      });

      // Someone else cannot see or drive this run.
      expect((await api.get(`/api/v1/me/journeys/${id}`).set('Cookie', other)).status).toBe(404);
      expect((await step(id, 'gone', { op: 'verify' }, other)).status).toBe(404);

      const done = await step(id, 'gone', { op: 'verify' });
      expect(done.body).toMatchObject({ state: 'done', current: null });
      expect(done.body.auditId).toEqual(expect.any(Number));
      const { rows } = await pool.query<{
        method: string;
        path: string;
        switch_id: string;
        after: { steps: unknown[] };
      }>('SELECT method, path, switch_id, after FROM audit_log WHERE id = $1', [done.body.auditId]);
      expect(rows[0]).toMatchObject({ method: 'JOURNEY', path: '/journeys/route-leak', switch_id: 'swj' });
      expect(rows[0]?.after.steps.length).toBeGreaterThanOrEqual(6);
      expect((await step(id, 'gone', { op: 'verify' })).status).toBe(409);

      const mine = await api.get('/api/v1/me/journeys').set('Cookie', op).query(scope);
      expect((mine.body.runs as Array<{ id: string }>).map((r) => r.id)).toContain(id);

      // A role without the read: the check cannot run, the step blocks, the denial is audited.
      const denied = await api
        .post('/api/v1/me/journeys')
        .set('Cookie', none)
        .send({ journey: 'route-leak', scope });
      expect(denied.status).toBe(201);
      await step(
        denied.body.id,
        'leak',
        { op: 'submit', values: { vrf: 'RED', prefix: '10.20.0.0/16' } },
        none,
      );
      const blocked = await step(denied.body.id, 'present', { op: 'verify' }, none);
      // A failed read is not "absent": no onFail branch, the run blocks on the error.
      expect(blocked.body).toMatchObject({ state: 'blocked', current: 'present' });
      expect(blocked.body.steps.present.evidence[0].error).toMatch(/not granted/);
      const denials = await pool.query(
        `SELECT 1 FROM audit_log WHERE user_sub = 'qj-none' AND method = 'GET' AND path LIKE '/vrf/RED/router/rib/%'`,
      );
      expect(denials.rowCount).toBeGreaterThan(0);

      // Abandon closes the run and audits it; a closed run refuses more steps.
      const gone = await api.delete(`/api/v1/me/journeys/${denied.body.id}`).set('Cookie', none);
      expect(gone.body).toMatchObject({ state: 'abandoned', auditId: expect.any(Number) });
      expect((await api.delete(`/api/v1/me/journeys/${denied.body.id}`).set('Cookie', none)).status).toBe(
        409,
      );
    } finally {
      for (const u of USERS) dropUserTokens(u);
      await pool.query('DELETE FROM journey_runs WHERE user_sub = ANY($1)', [USERS]);
      await pool.query('DELETE FROM sessions WHERE user_sub = ANY($1)', [USERS]);
      await pool.query('DELETE FROM user_roles WHERE user_sub = ANY($1)', [USERS]);
      await pool.query(`DELETE FROM roles WHERE id = 'qj-empty'`);
      await pool.query('DELETE FROM switches WHERE id = $1', ['swj']);
      await pool.end();
      await fake.close();
      await app.close();
    }
  });
});
