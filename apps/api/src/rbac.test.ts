/**
 * RBAC tests (roadmap 0.8). The gate matrix is pure; route tests seed sessions
 * directly (Keycloak itself is proven in auth.test.ts, hardware proves live).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { Pool, type Pool as PoolType } from 'pg';
import { randomUUID } from 'node:crypto';
import { buildApp } from './app.js';
import { migrate } from './db.js';
import { type AuthConfig } from './auth/config.js';
import { capabilities, gateCheck, getUserRoles, type Role } from './rbac/store.js';

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
if (!LIVE) console.warn('rbac tests skipped: DATABASE_URL unreachable');

function role(over: Partial<Role> & { id: string }): Role {
  return {
    display_name: over.id,
    description: '',
    system: false,
    can_dangerous: false,
    rules: [],
    groups: [],
    ...over,
  };
}

describe('gateCheck (pure, deny-by-default)', () => {
  const viewer = role({ id: 'v', rules: [{ method: 'GET', path_prefix: '/' }] });
  const op = role({
    id: 'op',
    rules: [
      { method: 'GET', path_prefix: '/' },
      { method: 'PATCH', path_prefix: '/interface' },
      { method: 'POST', path_prefix: '/interface' },
    ],
  });
  const scoped = role({
    id: 's',
    rules: [{ method: 'PATCH', path_prefix: '/interface' }],
    groups: ['DC1-leaf'],
  });

  it('allows granted, denies everything else', () => {
    expect(gateCheck([viewer], { method: 'GET', path: '/interface' })).toBe(true);
    expect(gateCheck([viewer], { method: 'PATCH', path: '/interface' })).toBe(false);
    expect(gateCheck([], { method: 'GET', path: '/interface' })).toBe(false);
    expect(gateCheck([op], { method: 'get', path: '/interface' })).toBe(true); // case-insensitive method
    expect(gateCheck([op], { method: 'POST', path: '/config' })).toBe(false); // never granted
    expect(gateCheck([op], { method: 'PATCH', path: '/system/aaa' })).toBe(false);
  });

  it('dangerous paths need can_dangerous', () => {
    const admin = role({ id: 'a', rules: [{ method: 'POST', path_prefix: '/system' }], can_dangerous: true });
    expect(gateCheck([op], { method: 'POST', path: '/system/image' })).toBe(false);
    expect(gateCheck([admin], { method: 'POST', path: '/system/image' })).toBe(true);
    expect(gateCheck([admin], { method: 'POST', path: '/system/image/files/x' })).toBe(true);
  });

  it('scopes to switch groups; our-API paths skip scope', () => {
    expect(
      gateCheck([scoped], { method: 'PATCH', path: '/interface/swp1', switchGroups: ['DC1-leaf'] }),
    ).toBe(true);
    expect(
      gateCheck([scoped], { method: 'PATCH', path: '/interface/swp1', switchGroups: ['DC1-spine'] }),
    ).toBe(false);
    const api = role({ id: 'api', rules: [{ method: 'GET', path_prefix: '/api/v1/audit' }] });
    expect(gateCheck([api], { method: 'GET', path: '/api/v1/audit' })).toBe(true);
  });

  it('namespaces never cross: broad NVUE grants stop at /api', () => {
    const viewer = role({ id: 'v', rules: [{ method: 'GET', path_prefix: '/' }] });
    expect(gateCheck([viewer], { method: 'GET', path: '/api/v1/audit' })).toBe(false);
    expect(gateCheck([viewer], { method: 'GET', path: '/interface' })).toBe(true);
  });

  it('capabilities flattens for UI hints', () => {
    const caps = capabilities([op]);
    expect(caps.roles).toEqual(['op']);
    expect(caps.can_dangerous).toBe(false);
    expect(caps.rules.length).toBe(3);
  });
});

describe.skipIf(!LIVE)('rbac routes + seeds', () => {
  let pool: PoolType;

  beforeAll(async () => {
    await migrate();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  /** Insert a session row directly and return its cookie header. */
  async function cookieFor(sub: string, keycloakRoles: string[]): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO sessions (id, user_sub, username, roles, user_groups, refresh_enc)
       VALUES ($1, $2, $3, $4, '[]', 'sealed')`,
      [id, sub, sub, JSON.stringify(keycloakRoles)],
    );
    return `cumulus_session=${id}`;
  }

  async function appWithAuth() {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    return app;
  }

  it('ships the seven defaults; matrix holds on real rows', async () => {
    const app = await appWithAuth();
    try {
      const cookie = await cookieFor('boss', ['app-admin']);
      const list = await request(app.server).get('/api/v1/roles').set('Cookie', cookie);
      expect(list.status).toBe(200);
      expect(list.body.map((r: { id: string }) => r.id).sort()).toEqual([
        'app-admin',
        'auditor',
        'net-admin',
        'net-operator',
        'noc',
        'sys-admin',
        'viewer',
      ]);
      await pool.query(`INSERT INTO user_roles (user_sub, role_id) VALUES ('op1', 'net-operator')`);
      const roles = await getUserRoles('op1');
      expect(gateCheck(roles, { method: 'PATCH', path: '/interface/swp1' })).toBe(true);
      expect(gateCheck(roles, { method: 'POST', path: '/config' })).toBe(false);
      await pool.query(`DELETE FROM user_roles WHERE user_sub = 'op1'`);
    } finally {
      await app.close();
    }
  });

  it('bootstrap: non-admin gets 403 everywhere admin', async () => {
    const app = await appWithAuth();
    try {
      const cookie = await cookieFor('pleb', ['viewer']);
      expect(await request(app.server).get('/api/v1/roles').set('Cookie', cookie)).toMatchObject({
        status: 403,
      });
      expect(await request(app.server).post('/api/v1/roles').set('Cookie', cookie).send({})).toMatchObject({
        status: 403,
      });
      expect(await request(app.server).get('/api/v1/me/capabilities').set('Cookie', cookie)).toMatchObject({
        status: 200,
      });
      expect(await request(app.server).get('/api/v1/me/capabilities')).toMatchObject({ status: 401 });
    } finally {
      await app.close();
    }
  });

  it('custom roles: create, duplicate 409, delete; system immutable', async () => {
    const app = await appWithAuth();
    try {
      const cookie = await cookieFor('boss2', ['app-admin']);
      const api = request(app.server);
      const created = await api
        .post('/api/v1/roles')
        .set('Cookie', cookie)
        .send({
          id: 'leaf-tech',
          display_name: 'Leaf tech',
          rules: [{ method: 'PATCH', path_prefix: '/interface' }],
          groups: [],
        });
      expect(created.status).toBe(201);
      const dup = await api
        .post('/api/v1/roles')
        .set('Cookie', cookie)
        .send({ id: 'viewer', display_name: 'x' });
      expect(dup.status).toBe(409);
      const bad = await api.post('/api/v1/roles').set('Cookie', cookie).send({ id: 'x' });
      expect(bad.status).toBe(400);
      expect(await api.delete('/api/v1/roles/viewer').set('Cookie', cookie)).toMatchObject({ status: 409 });
      expect(await api.delete('/api/v1/roles/leaf-tech').set('Cookie', cookie)).toMatchObject({
        status: 200,
      });
      expect(await api.delete('/api/v1/roles/leaf-tech').set('Cookie', cookie)).toMatchObject({
        status: 404,
      });
    } finally {
      await app.close();
    }
  });

  it('grant + capabilities reflect stored roles', async () => {
    const app = await appWithAuth();
    try {
      const admin = await cookieFor('boss3', ['app-admin']);
      const api = request(app.server);
      await api.post('/api/v1/roles/grant').set('Cookie', admin).send({ user_sub: 'tech1', role_id: 'noc' });
      const user = await cookieFor('tech1', []);
      const caps = await api.get('/api/v1/me/capabilities').set('Cookie', user);
      expect(caps.body.roles).toEqual(['noc']);
      expect(caps.body.rules.map((r: { role: string }) => r.role)).toContain('noc');
      await pool.query(`DELETE FROM user_roles WHERE user_sub = 'tech1'`);
    } finally {
      await app.close();
    }
  });
});
