/**
 * Shared fake-NVUE HTTPS stub for Phase 1 tests: openssl self-signed cert,
 * caller-supplied handler, returns {url, pin, caPem, close, hits}.
 * Real TLS + real TOFU pinning — only the API semantics are faked.
 */
import { createServer, type Server } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type NvueHandler = (
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
) => void | Promise<void>;

export interface FakeNvue {
  baseUrl: string;
  pin: string;
  caPem: string;
  hits: string[];
  close: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text.length > 0 ? (JSON.parse(text) as unknown) : null);
      } catch {
        resolve(text);
      }
    });
  });
}

/** Start the stub. Handler receives parsed bodies and records `METHOD path`. */
export async function startFakeNvue(handler: NvueHandler): Promise<FakeNvue> {
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
  const fp = execFileSync('openssl', ['x509', '-in', cert, '-noout', '-fingerprint', '-sha256'], {
    encoding: 'utf8',
  });
  const pin = `SHA256:${fp.split('=')[1]?.replace(/:/g, '').trim()}`;
  const hits: string[] = [];
  const server: Server = createServer({ key: readFileSync(key), cert: pem }, (req, res) => {
    void (async () => {
      const body = await readBody(req);
      hits.push(`${req.method} ${req.url}`);
      await handler(Object.assign(req, { body }), res);
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    baseUrl: `https://127.0.0.1:${port}`,
    pin,
    caPem: pem,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** JSON responder for stubs. */
export function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}
