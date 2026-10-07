/**
 * Counter history tests: pure counter math, rollup compaction, the history
 * and live-seed endpoints (seeded SQL rows — no switch needed for reads),
 * and the sampler's token reuse against a fake switch.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool, type Pool as PoolType } from 'pg';
import { buildApp } from '../app.js';
import { migrate, db } from '../db.js';
import { type AuthConfig } from '../auth/config.js';
import { sessionCookie } from '../test-sessions.js';
import { counterDelta, extractCounters, rollupTick, sampleSwitch } from './sampler.js';
import { setSwitchCredential } from '../users/store.js';
import { dropUserTokens, getSwitchToken, setSwitchToken } from '../switchauth/sessions.js';
import { startFakeNvue, json } from '../test-nvue.js';
import { mergeHours, toRates } from './routes.js';

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
if (!LIVE) console.warn('history tests skipped: DATABASE_URL unreachable');

describe('counter math (pure)', () => {
  it('extracts link/stats counters, ignores junk', () => {
    expect(
      extractCounters({ link: { stats: { 'in-bytes': 10, 'out-bytes': 20, 'in-pkts': 1, 'out-pkts': 2 } } }),
    ).toEqual({ inB: 10, outB: 20, inP: 1, outP: 2, drops: 0, errors: 0 });
    expect(extractCounters({})).toEqual({ inB: 0, outB: 0, inP: 0, outP: 0, drops: 0, errors: 0 });
    expect(extractCounters({ link: { stats: { 'in-bytes': 'x', 'out-bytes': null } } }).inB).toBe(0);
  });

  it('deltas go reset-aware, never negative', () => {
    expect(counterDelta(100, 160)).toBe(60);
    expect(counterDelta(100, 50)).toBe(50);
    expect(counterDelta(0, 0)).toBe(0);
  });

  it('rates divide by elapsed time and stride-cap', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      ts: new Date(Date.now() + i * 60000),
      a: i * 600,
      b: i * 1200,
    }));
    const pts = toRates(rows);
    expect(pts).toHaveLength(4);
    expect(pts[0]?.in).toBeCloseTo(10);
    expect(pts[0]?.out).toBeCloseTo(20);
    expect(toRates([{ ts: new Date(), a: 5, b: 5 }])).toEqual([]);
  });
});

describe.skipIf(!LIVE)('history endpoint + rollup', () => {
  let pool: PoolType;

  beforeAll(async () => {
    await migrate();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('serves raw ranges, compacts old rows into hourly buckets', async () => {
    await db().query(
      `INSERT INTO switches (id, display_name, base_url) VALUES ('sh1', 't', 'https://sh1:8765')
       ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url`,
    );
    const base = Date.now();
    // Recent raw rows (last hour, 10 min apart).
    for (let i = 6; i >= 0; i--) {
      await db().query(
        `INSERT INTO interface_samples (switch_id, iface, ts, in_bytes, out_bytes, in_pkts, out_pkts, drops, errors)
         VALUES ('sh1', 'swp1', $1, $2, $3, $2, $3, 0, 0) ON CONFLICT DO NOTHING`,
        [new Date(base - i * 600_000), i * 6000, i * 600],
      );
    }
    // Old rows (10 days ago, one per hour for 3 hours, rising counters).
    for (let h = 0; h < 3; h++) {
      await db().query(
        `INSERT INTO interface_samples (switch_id, iface, ts, in_bytes, out_bytes, in_pkts, out_pkts, drops, errors)
         VALUES ('sh1', 'swp1', $1, $2, $3, $2, $3, 0, 0) ON CONFLICT DO NOTHING`,
        [new Date(base - 10 * 86400_000 - h * 3600_000), 1000 + h * 3600, 100 + h * 360],
      );
    }
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const cookie = await sessionCookie(pool, 'qh-user', { appRoles: ['app-admin'] });
    const api = request(app.server);
    try {
      expect(await api.get('/api/v1/switches/sh1/interfaces/swp1/history')).toMatchObject({ status: 401 });
      expect(
        await api.get('/api/v1/switches/nope/interfaces/swp1/history').set('Cookie', cookie),
      ).toMatchObject({
        status: 404,
      });
      expect(
        await api.get('/api/v1/switches/sh1/interfaces/swp1/history?range=bogus').set('Cookie', cookie),
      ).toMatchObject({ status: 400 });

      const day = await api
        .get('/api/v1/switches/sh1/interfaces/swp1/history?range=24h&metric=bytes')
        .set('Cookie', cookie);
      expect(day.status).toBe(200);
      expect(day.body.points.length).toBeGreaterThan(0);
      expect(day.body.points[0]).toHaveProperty('in');
      expect(day.body.points[0]).toHaveProperty('out');

      const rolled = await rollupTick();
      expect(rolled.hours).toBeGreaterThan(0);
      const oldLeft = await db().query(
        `SELECT count(*) n FROM interface_samples WHERE switch_id = 'sh1' AND ts < now() - interval '7 days'`,
      );
      expect(Number(oldLeft.rows[0]?.n)).toBe(0);

      // A short window wholly past raw retention (a comparison 10 days back)
      // reads hourly buckets instead of coming back empty.
      const oldFrom = new Date(base - 10 * 86400_000 - 3 * 3600_000).toISOString();
      const oldTo = new Date(base - 10 * 86400_000 + 3600_000).toISOString();
      const old = await api
        .get(
          `/api/v1/switches/sh1/interfaces/swp1/history?from=${encodeURIComponent(oldFrom)}&to=${encodeURIComponent(oldTo)}&metric=bytes`,
        )
        .set('Cookie', cookie);
      expect(old.status).toBe(200);
      expect(old.body.points.length).toBeGreaterThan(0);
      // History start survives the rollup (hourly buckets count).
      expect(Date.parse(old.body.earliest)).toBeLessThan(Date.parse(oldTo));

      const month = await api
        .get('/api/v1/switches/sh1/interfaces/swp1/history?range=30d&metric=bytes')
        .set('Cookie', cookie);
      expect(month.status).toBe(200);
      expect(month.body.points.length).toBeGreaterThan(0);

      const now = new Date();
      const dayAgo = new Date(now.getTime() - 86400_000).toISOString();
      const custom = await api
        .get(
          `/api/v1/switches/sh1/interfaces/swp1/history?from=${encodeURIComponent(dayAgo)}&to=${encodeURIComponent(now.toISOString())}&metric=bytes`,
        )
        .set('Cookie', cookie);
      expect(custom.status).toBe(200);
      expect(custom.body.points.length).toBeGreaterThan(0);

      const agg = await api.get('/api/v1/switches/sh1/traffic?range=24h&metric=bytes').set('Cookie', cookie);
      expect(agg.status).toBe(200);
      expect(agg.body.points.length).toBeGreaterThan(0);
      expect(agg.body.points[0]).toHaveProperty('in');
      expect(agg.body.points[0]).toHaveProperty('out');

      const flipped = await api
        .get(
          `/api/v1/switches/sh1/interfaces/swp1/history?from=${encodeURIComponent(now.toISOString())}&to=${encodeURIComponent(dayAgo)}`,
        )
        .set('Cookie', cookie);
      expect(flipped.status).toBe(400);
    } finally {
      await pool.query(`DELETE FROM interface_samples WHERE switch_id = 'sh1'`);
      await pool.query(`DELETE FROM interface_samples_hourly WHERE switch_id = 'sh1'`);
      await pool.query(`DELETE FROM sessions WHERE user_sub = 'qh-user'`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub = 'qh-user'`);
      await pool.query(`DELETE FROM users WHERE id = 'qh-user'`);
      await pool.query(`DELETE FROM switches WHERE id = 'sh1'`);
      await app.close();
    }
  });
  it('serves recent raw readings to seed the live graph; denies uncovered users', async () => {
    await db().query(
      `INSERT INTO switches (id, display_name, base_url) VALUES ('sh2', 't', 'https://sh2:8765')
       ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url`,
    );
    const base = Date.now();
    for (const ago of [30, 20, 10, 1]) {
      await db().query(
        `INSERT INTO interface_samples (switch_id, iface, ts, in_bytes, out_bytes, in_pkts, out_pkts, drops, errors)
         VALUES ('sh2', 'swp1', $1, $2, $2, $2, $2, 1, 2) ON CONFLICT DO NOTHING`,
        [new Date(base - ago * 60_000), (100 - ago) * 1000],
      );
    }
    const app = await buildApp({ auth: { cfg: CFG } });
    await app.ready();
    const admin = await sessionCookie(pool, 'qh-admin', { appRoles: ['app-admin'] });
    const nobody = await sessionCookie(pool, 'qh-nobody');
    const api = request(app.server);
    try {
      expect(await api.get('/api/v1/switches/sh2/interfaces/swp1/samples')).toMatchObject({ status: 401 });
      expect(
        await api.get('/api/v1/switches/sh2/interfaces/swp1/samples').set('Cookie', nobody),
      ).toMatchObject({ status: 403 });
      expect(
        await api.get('/api/v1/switches/sh2/interfaces/swp1/samples?minutes=0').set('Cookie', admin),
      ).toMatchObject({ status: 400 });

      const res = await api
        .get('/api/v1/switches/sh2/interfaces/swp1/samples?minutes=15')
        .set('Cookie', admin);
      expect(res.status).toBe(200);
      // 15 minutes back: the 10- and 1-minute-old readings, oldest first, numeric.
      expect(res.body.samples).toHaveLength(2);
      expect(Date.parse(res.body.earliest)).toBeLessThanOrEqual(res.body.samples[0].t);
      expect(res.body.samples[0]).toMatchObject({ inB: 90_000, outB: 90_000, dr: 1, er: 2 });
      expect(res.body.samples[0].t).toBeLessThan(res.body.samples[1].t);

      // Coverage: same gate; hours holding two+ readings come back as spans.
      expect(
        await api.get('/api/v1/switches/sh2/interfaces/swp1/coverage').set('Cookie', nobody),
      ).toMatchObject({ status: 403 });
      const cov = await api.get('/api/v1/switches/sh2/interfaces/swp1/coverage').set('Cookie', admin);
      expect(cov.status).toBe(200);
      expect(cov.body.spans.length).toBeGreaterThan(0);
      const first = cov.body.spans[0];
      expect(Date.parse(first.from)).toBeLessThanOrEqual(base - 10 * 60_000);
      expect((Date.parse(first.to) - Date.parse(first.from)) % 3600_000).toBe(0);
    } finally {
      await pool.query(`DELETE FROM interface_samples WHERE switch_id = 'sh2'`);
      await pool.query(`DELETE FROM sessions WHERE user_sub IN ('qh-admin', 'qh-nobody')`);
      await pool.query(`DELETE FROM user_roles WHERE user_sub IN ('qh-admin', 'qh-nobody')`);
      await pool.query(`DELETE FROM users WHERE id IN ('qh-admin', 'qh-nobody')`);
      await pool.query(`DELETE FROM switches WHERE id = 'sh2'`);
      await app.close();
    }
  });

  it('sampler rides the cached user token instead of minting every tick', async () => {
    let mints = 0;
    const fake = await startFakeNvue((req, res) => {
      const url = new URL(req.url ?? '/', 'https://x');
      if (url.pathname === '/nvue_v1/api-token') {
        mints++;
        json(res, 200, { token: 'minted-jwt' });
      } else if (url.pathname === '/nvue_v1/interface') {
        json(res, 200, { swp1: { link: { stats: { 'in-bytes': 5, 'out-bytes': 6 } } } });
      } else {
        json(res, 404, { message: 'nope' });
      }
    });
    await db().query(
      `INSERT INTO switches (id, display_name, base_url, cert_fingerprint, cert_pem, trust_verified)
       VALUES ('sh3', 't', $1, $2, $3, true)
       ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url, cert_fingerprint = EXCLUDED.cert_fingerprint,
         cert_pem = EXCLUDED.cert_pem, trust_verified = true`,
      [fake.baseUrl, fake.pin, fake.caPem],
    );
    await sessionCookie(pool, 'qh-sampler');
    await setSwitchCredential('qh-sampler', 'sh3', 'cumulus', 's3cret', CFG.credKey);
    try {
      setSwitchToken('qh-sampler', 'sh3', 'cached-jwt');
      expect(await sampleSwitch(CFG.credKey, 'qh-sampler', 'sh3')).toBe(1);
      expect(mints).toBe(0);
      expect(getSwitchToken('qh-sampler', 'sh3')).toBe('cached-jwt');

      // No cached token: mint once, then keep riding it.
      dropUserTokens('qh-sampler');
      await sampleSwitch(CFG.credKey, 'qh-sampler', 'sh3');
      await sampleSwitch(CFG.credKey, 'qh-sampler', 'sh3');
      expect(mints).toBe(1);
      expect(getSwitchToken('qh-sampler', 'sh3')).toBe('minted-jwt');
    } finally {
      dropUserTokens('qh-sampler');
      await pool.query(`DELETE FROM interface_samples WHERE switch_id = 'sh3'`);
      await pool.query(`DELETE FROM switch_credentials WHERE user_sub = 'qh-sampler'`);
      await pool.query(`DELETE FROM sessions WHERE user_sub = 'qh-sampler'`);
      await pool.query(`DELETE FROM users WHERE id = 'qh-sampler'`);
      await pool.query(`DELETE FROM switches WHERE id = 'sh3'`);
      await fake.close();
    }
  });
});

describe('mergeHours', () => {
  const H = 3600_000;
  it('joins back-to-back hours and splits at gaps', () => {
    expect(mergeHours([0, H, 2 * H, 5 * H])).toEqual([
      { from: new Date(0).toISOString(), to: new Date(3 * H).toISOString() },
      { from: new Date(5 * H).toISOString(), to: new Date(6 * H).toISOString() },
    ]);
    expect(mergeHours([])).toEqual([]);
  });
});
