/**
 * Platform auth tests (roadmap: users are created in our UI).
 * Login/logout/me, disabled accounts, wrong passwords, idle expiry,
 * and logout dropping switch tokens.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { Pool, type Pool as PoolType } from 'pg';
import { buildApp } from './app.js';
import { migrate } from './db.js';
import { type AuthConfig } from './auth/config.js';
import { hashPassword } from './users/store.js';
import { getSwitchToken, setSwitchToken, dropUserTokens } from './switchauth/sessions.js';

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
if (!LIVE) console.warn('auth tests skipped: DATABASE_URL unreachable');

describe('password hashing (pure)', () => {
  it('round-trips and rejects wrong passwords and garbage', async () => {
    const { verifyPassword } = await import('./users/store.js');
    const hash = hashPassword('correct-horse-123');
    expect(verifyPassword('correct-horse-123', hash)).toBe(true);
    expect(verifyPassword('wrong', hash)).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe.skipIf(!LIVE)('auth routes', () => {
  let pool: PoolType;

  beforeAll(async () => {
    await migrate();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(
      `INSERT INTO users (id, display_name, password_hash) VALUES ('alice', 'Alice', $1), ('mallory', 'Mallory', $2)
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, disabled = false`,
      [hashPassword('alice-password-123'), hashPassword('mallory-password-123')],
    );
  });

  it('login → cookie → me; wrong password and unknown user → 401', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    try {
      const agent = request.agent(app.server);
      const res = await agent
        .post('/api/v1/auth/login')
        .send({ username: 'alice', password: 'alice-password-123' });
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ id: 'alice' });
      expect(String(res.headers['set-cookie'])).toContain('cumulus_session');
      expect((await agent.get('/api/v1/auth/me')).body.user.id).toBe('alice');

      const bad = await request(app.server)
        .post('/api/v1/auth/login')
        .send({ username: 'alice', password: 'nope' });
      expect(bad.status).toBe(401);
      const ghost = await request(app.server)
        .post('/api/v1/auth/login')
        .send({ username: 'ghost', password: 'x'.repeat(20) });
      expect(ghost.status).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('disabled accounts cannot log in', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    try {
      await pool.query(`UPDATE users SET disabled = true WHERE id = 'mallory'`);
      const res = await request(app.server)
        .post('/api/v1/auth/login')
        .send({ username: 'mallory', password: 'mallory-password-123' });
      expect(res.status).toBe(401);
    } finally {
      await pool.query(`UPDATE users SET disabled = false WHERE id = 'mallory'`);
      await app.close();
    }
  });

  it('logout clears session and switch tokens; idle sessions die', async () => {
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const agent = request.agent(app.server);
    try {
      await agent.post('/api/v1/auth/login').send({ username: 'alice', password: 'alice-password-123' });
      setSwitchToken('alice', 'sw9', 'dummy-jwt');
      expect((await agent.post('/api/v1/auth/logout')).status).toBe(200);
      expect(await agent.get('/api/v1/auth/me')).toMatchObject({ status: 401 });
      expect(getSwitchToken('alice', 'sw9')).toBeNull();

      await agent.post('/api/v1/auth/login').send({ username: 'alice', password: 'alice-password-123' });
      await pool.query(
        `UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE user_sub = 'alice'`,
      );
      expect(await agent.get('/api/v1/auth/me')).toMatchObject({ status: 401 });
    } finally {
      dropUserTokens('alice');
      await app.close();
    }
  });
});
