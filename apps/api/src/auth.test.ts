/**
 * HumanAuth tests (roadmap 0.5). No Keycloak needed: tokens are self-signed
 * with a local keypair (createLocalJWKSet) and the refresh endpoint is stubbed.
 * DB-gated like the inventory tests — CI always provides Postgres.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { buildApp } from './app.js';
import { migrate } from './db.js';
import { type AuthConfig } from './auth/config.js';
import { localKeys, toIdentity } from './auth/oidc.js';
import { openRefresh, sealRefresh } from './auth/session.js';
import { COOKIE } from './auth/routes.js';
import { dropUserTokens, getSwitchToken, setSwitchToken } from './switchauth/sessions.js';

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
if (!LIVE) console.warn('auth tests skipped: DATABASE_URL unreachable (start db via compose)');

describe('toIdentity (pure)', () => {
  it('merges realm + client roles, reads groups, falls back to sub', () => {
    const id = toIdentity(
      {
        sub: 'u1',
        realm_access: { roles: ['a', 'b'] },
        resource_access: { 'cumulus-ui': { roles: ['b', 'c'] }, other: { roles: ['x'] } },
        groups: ['DC1'],
      },
      'cumulus-ui',
    );
    expect(id).toEqual({ sub: 'u1', username: 'u1', roles: ['a', 'b', 'c'], groups: ['DC1'] });
  });

  it('uses preferred_username and rejects missing sub', () => {
    expect(toIdentity({ sub: 'u', preferred_username: 'yves' }, 'c').username).toBe('yves');
    expect(() => toIdentity({}, 'c')).toThrow();
  });
});

describe('seal/open (pure)', () => {
  it('round-trips, rejects tamper and wrong secret', () => {
    const sealed = sealRefresh('refresh-1', CFG);
    expect(openRefresh(sealed, CFG)).toBe('refresh-1');
    expect(() => openRefresh(sealed.slice(0, -2) + 'xx', CFG)).toThrow();
    expect(() => openRefresh(sealed, { ...CFG, sessionSecret: 'other-secret-long-enough-12345' })).toThrow();
  });
});

describe.skipIf(!LIVE)('auth routes', () => {
  let keys: ReturnType<typeof localKeys>;
  let sign: (claims: Record<string, unknown>) => Promise<string>;
  let stub: Server;
  let stubTokens: { access: string; refresh: string; status: number };

  beforeAll(async () => {
    await migrate();
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const pub = await exportJWK(publicKey);
    keys = localKeys({ keys: [{ ...pub, kid: 'test', alg: 'RS256' }] });
    const iss = `${CFG.keycloakUrl}/realms/${CFG.realm}`;
    sign = (claims) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: 'test' })
        .setIssuer(iss)
        .setAudience(CFG.clientId)
        .setExpirationTime('5m')
        .sign(privateKey);
    stubTokens = { access: '', refresh: 'rotated', status: 200 };
    stub = createServer((req, res) => {
      res.writeHead(stubTokens.status, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: stubTokens.access,
          refresh_token: stubTokens.refresh,
          expires_in: 300,
        }),
      );
    });
    await new Promise<void>((resolve) => stub.listen(0, resolve));
    const port = (stub.address() as { port: number }).port;
    stubTokens.access = await sign({ sub: 'u1', preferred_username: 'yves' });
    stubFetch = async () => fetch(`http://127.0.0.1:${port}/token`);
  });

  let stubFetch: typeof fetch;

  async function loginAgent() {
    const app = await buildApp({ auth: { cfg: CFG, keys, refreshFetch: stubFetch } });
    await app.ready();
    const agent = request.agent(app.server);
    const access = await sign({
      sub: 'u1',
      preferred_username: 'yves',
      realm_access: { roles: ['net-admin'] },
    });
    const res = await agent
      .post('/api/v1/auth/login')
      .send({ access_token: access, refresh_token: 'refresh-1' });
    return { app, agent, res };
  }

  it('login → cookie → me; bad token → 401', async () => {
    const { app, agent, res } = await loginAgent();
    try {
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ sub: 'u1', username: 'yves', roles: ['net-admin'] });
      expect(String(res.headers['set-cookie'])).toContain(COOKIE);
      const me = await agent.get('/api/v1/auth/me');
      expect(me.body.user.sub).toBe('u1');

      const bad = await request(app.server)
        .post('/api/v1/auth/login')
        .send({ access_token: 'nope', refresh_token: 'x' });
      expect(bad.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('refresh rotates; rejected refresh kills the session', async () => {
    const { app, agent } = await loginAgent();
    try {
      const ok = await agent.post('/api/v1/auth/refresh');
      expect(ok.status).toBe(200);
      expect(ok.body.user.sub).toBe('u1');

      stubTokens = { access: '', refresh: '', status: 400 };
      const dead = await agent.post('/api/v1/auth/refresh');
      expect(dead.status).toBe(401);
      const me = await agent.get('/api/v1/auth/me');
      expect(me.status).toBe(401);
    } finally {
      stubTokens = { access: await sign({ sub: 'u1' }), refresh: 'rotated', status: 200 };
      await app.close();
    }
  });

  it('logout clears session, switch tokens; idle sessions die', async () => {
    const { app, agent } = await loginAgent();
    try {
      setSwitchToken('u1', 'sw9', 'dummy-jwt');
      const out = await agent.post('/api/v1/auth/logout');
      expect(out.status).toBe(200);
      expect(await agent.get('/api/v1/auth/me')).toMatchObject({ status: 401 });
      expect(getSwitchToken('u1', 'sw9')).toBeNull();
      dropUserTokens('u1');

      const second = await loginAgent2(app);
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        await pool.query(
          `UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE username = 'yves'`,
        );
      } finally {
        await pool.end();
      }
      expect(await second.get('/api/v1/auth/me')).toMatchObject({ status: 401 });
    } finally {
      await app.close();
      stub.close();
    }
  });

  async function loginAgent2(app: Awaited<ReturnType<typeof buildApp>>) {
    const agent = request.agent(app.server);
    const access = await sign({ sub: 'u1', preferred_username: 'yves' });
    await agent.post('/api/v1/auth/login').send({ access_token: access, refresh_token: 'refresh-1' });
    return agent;
  }
});
