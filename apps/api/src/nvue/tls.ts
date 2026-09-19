/**
 * TOFU-pinned TLS (roadmap 0.4/0.6). Every connection to a switch verifies the
 * presented certificate against the fingerprint captured at enrolment.
 * Unenrolled (NULL pin) → refuse, never blind-trust. Shared by token mint (0.6)
 * and NvueClient (0.7) so pinning cannot be bypassed per call-site.
 */
import { createHash } from 'node:crypto';
import type { PeerCertificate } from 'node:tls';
import { Agent, get } from 'node:https';
import { verifyFingerprint } from '../inventory/store.js';

/** SHA-256 fingerprint of a peer certificate, same format as enrolment capture. */
export function fingerprintOf(cert: PeerCertificate): string {
  const raw = cert.raw;
  if (!raw) throw new Error('peer presented no certificate bytes');
  return `SHA256:${createHash('sha256').update(raw).digest('hex').toUpperCase()}`;
}

/**
 * HTTPS agent that enforces the TOFU pin. Two layers, both required:
 * - `ca` is the enrolled certificate itself, so chain verification stays ON
 *   (Node skips checkServerIdentity entirely when rejectUnauthorized is false —
 *   verified empirically: the callback never fires).
 * - checkServerIdentity compares the presented fingerprint to the enrolled pin.
 * Either layer failing aborts the handshake before any HTTP bytes are sent.
 */
export function pinnedAgent(pin: string, caPem: string): Agent {
  return new Agent({
    ca: caPem,
    checkServerIdentity: (_host, cert) => {
      try {
        if (!verifyFingerprint(pin, fingerprintOf(cert))) {
          return new Error('switch certificate does not match enrolled TOFU pin');
        }
        return undefined;
      } catch (err) {
        return err instanceof Error ? err : new Error(String(err));
      }
    },
  });
}

export interface JsonRequest {
  url: string;
  username: string;
  password: string;
  pin: string;
  caPem: string;
}

export interface JsonResult {
  status: number;
  data: unknown;
}

/** Read + parse a JSON response body. Shared by token mint and NvueClient. Exported for reuse. */
export function readJson(res: import('node:http').IncomingMessage): Promise<JsonResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve({
          status: res.statusCode ?? 500,
          data: text.length === 0 ? null : (JSON.parse(text) as unknown),
        });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    res.on('error', reject);
  });
}

/**
 * GET JSON with Basic auth over TOFU-pinned TLS. Plain http URLs are refused —
 * switch traffic is https-only in production; tests inject a stub instead.
 */
export function fetchJson({ url, username, password, pin, caPem }: JsonRequest): Promise<unknown> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') return Promise.reject(new Error('refusing non-https switch URL'));
  return new Promise((resolve, reject) => {
    const req = get(
      url,
      {
        agent: pinnedAgent(pin, caPem),
        headers: { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
      },
      (res) => {
        readJson(res).then(
          ({ status, data }) => {
            if (status >= 400) {
              reject(new Error(`switch answered ${status.toString()}`));
              return;
            }
            resolve(data);
          },
          (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
        );
      },
    );
    req.setTimeout(10000, () => req.destroy(new Error('switch request timed out')));
    req.on('error', reject);
  });
}
