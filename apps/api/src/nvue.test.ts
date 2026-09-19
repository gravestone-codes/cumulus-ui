/**
 * Transport tests (roadmap 0.7). Guard is pure; the client is proven live
 * against a local openssl-cert HTTPS stub that records what arrived.
 */
import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guardCall, GuardError } from './nvue/guard.js';
import { encodePath, NvueClient, NvueError } from './nvue/client.js';

const MANIFEST = {
  routes: { '/interface': ['get', 'patch'], '/interface/{id}': ['get'] },
  views: { '/interface': ['status', 'counters'] },
};

describe('guard (pure)', () => {
  it('passes a well-formed call', () => {
    expect(() =>
      guardCall(MANIFEST, { path: '/interface', method: 'GET', view: 'status', rev: 'applied' }),
    ).not.toThrow();
  });

  it('rejects unknown paths, bad methods, traversal', () => {
    expect(() => guardCall(MANIFEST, { path: '/nope', method: 'GET' })).toThrow(GuardError);
    expect(() => guardCall(MANIFEST, { path: '/interface', method: 'DELETE' })).toThrow(GuardError);
    expect(() => guardCall(MANIFEST, { path: '/../x', method: 'GET' })).toThrow(GuardError);
    expect(() => guardCall(MANIFEST, { path: '/interface', method: 'GET', view: 'bogus' })).toThrow(
      GuardError,
    );
    expect(() => guardCall(MANIFEST, { path: '/interface/{id}', method: 'GET', view: 'status' })).toThrow(
      GuardError,
    );
    expect(() => guardCall(MANIFEST, { path: '/interface', method: 'GET', rev: '' })).toThrow(GuardError);
    expect(() => guardCall(MANIFEST, { path: '/interface', method: 'PATCH', body: [1] })).toThrow(GuardError);
    expect(() =>
      guardCall(MANIFEST, { path: '/interface', method: 'PATCH', body: 'x'.repeat(2_000_000) }),
    ).toThrow(GuardError);
  });

  it('matches concrete ids against {template} routes', () => {
    expect(() => guardCall(MANIFEST, { path: '/interface/swp1', method: 'GET' })).not.toThrow();
    expect(() => guardCall(MANIFEST, { path: '/interface/swp1', method: 'PATCH' })).toThrow(GuardError);
    expect(() => guardCall(MANIFEST, { path: '/interface/swp1/eth', method: 'GET' })).toThrow(GuardError);
  });

  it('validates extra query params', () => {
    expect(() =>
      guardCall(MANIFEST, { path: '/interface', method: 'GET', params: { base_rev: 'applied' } }),
    ).not.toThrow();
    expect(() => guardCall(MANIFEST, { path: '/interface', method: 'GET', params: { 'a;b': 'x' } })).toThrow(
      GuardError,
    );
    expect(() => guardCall(MANIFEST, { path: '/interface', method: 'GET', params: { a: '' } })).toThrow(
      GuardError,
    );
  });

  it('encodes path segments', () => {
    expect(encodePath('/vrf/blue/router/fib/ipv4')).toBe('/vrf/blue/router/fib/ipv4');
    expect(encodePath('/interface/swp1.100')).toBe('/interface/swp1.100');
  });
});

describe('client (live stub)', () => {
  it('sends bearer + reqId + query, maps errors, gate blocks before network', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cumulus-nvue-'));
    const key = join(dir, 'k.pem');
    const cert = join(dir, 'c.pem');
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
    const pem = readFileSync(cert, 'utf8');
    const seen: Array<{ url?: string; auth?: string; reqId?: string; method?: string; body?: string }> = [];
    let hits = 0;
    const server: Server = createServer({ key: readFileSync(key), cert: pem }, (req, res) => {
      hits++;
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen.push({
          url: req.url,
          auth: req.headers.authorization,
          reqId: req.headers['x-request-id'] as string,
          method: req.method,
          body,
        });
        if (req.url?.startsWith('/nvue_v1/boom')) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ message: 'bad thing happened' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const fp = execFileSync('openssl', ['x509', '-in', cert, '-noout', '-fingerprint', '-sha256'], {
        encoding: 'utf8',
      });
      const pin = `SHA256:${fp.split('=')[1]?.replace(/:/g, '').trim()}`;
      const client = new NvueClient(
        { baseUrl: `https://127.0.0.1:${port}`, basePath: '/nvue_v1', pin, caPem: pem },
        { routes: { ...MANIFEST.routes, '/boom': ['get'] }, views: MANIFEST.views },
      );

      const res = await client.call({
        path: '/interface',
        method: 'GET',
        view: 'counters',
        rev: 'applied',
        token: 'tok',
        reqId: 'r1',
      });
      expect(res).toEqual({ status: 200, data: { ok: true } });
      expect(seen[0]).toMatchObject({ auth: 'Bearer tok', reqId: 'r1', method: 'GET' });
      expect(seen[0]?.url).toContain('rev=applied');
      expect(seen[0]?.url).toContain('view=counters');

      const err = await client.call({ path: '/boom', method: 'GET', token: 'tok' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NvueError);
      expect((err as NvueError).status).toBe(400);
      expect((err as NvueError).message).toContain('bad thing happened');

      const before = hits;
      await expect(client.call({ path: '/nope', method: 'GET', token: 'tok' })).rejects.toBeInstanceOf(Error);
      expect(hits).toBe(before); // gate refused before any network

      const wrong = new NvueClient(
        { baseUrl: `https://127.0.0.1:${port}`, basePath: '/nvue_v1', pin: 'SHA256:00', caPem: pem },
        MANIFEST,
      );
      await expect(wrong.call({ path: '/interface', method: 'GET', token: 'tok' })).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
