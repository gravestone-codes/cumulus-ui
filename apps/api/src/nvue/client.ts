/**
 * NvueClient (roadmap 0.7: Transport) — the ONLY way anything talks to a switch.
 * Every call passes the manifest gate first, rides TOFU-pinned TLS, and carries
 * the user's own Bearer token. reqId goes out as X-Request-ID so backend logs
 * pair with switch-side traces (decision 12).
 */
import { request as httpsRequest } from 'node:https';
import type { NvueManifest } from '@cumulus/spec/src/manifest.js';
import { pinnedAgent, readJson } from './tls.js';
import { guardCall, type GuardedCall } from './guard.js';

export interface NvueTarget {
  baseUrl: string;
  basePath: string;
  pin: string;
  caPem: string;
}

export interface NvueCall extends GuardedCall {
  /** The user's own switch JWT (from UserSwitchSession). Sent, never logged. */
  token: string;
  /** Backend request id, forwarded for log pairing. */
  reqId?: string;
}

/** Switch-side failure. Detail is switch prose, capped — bodies may echo input. */
export class NvueError extends Error {
  readonly status: number;
  readonly path: string;
  readonly method: string;
  constructor(status: number, method: string, path: string, detail: string) {
    super(`NVUE ${method} ${path} → ${status}: ${detail.slice(0, 500)}`);
    this.status = status;
    this.method = method;
    this.path = path;
  }
}

const TIMEOUT_MS = 15000;

/** Encode each path segment (ids may contain subnets, CIDRs, tildes). */
export function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

export class NvueClient {
  constructor(
    private readonly target: NvueTarget,
    private readonly manifest: Pick<NvueManifest, 'routes' | 'views'>,
  ) {}

  /** Run one gated call. Throws GuardError (400-side) or NvueError (switch-side). */
  async call(call: NvueCall): Promise<{ status: number; data: unknown }> {
    guardCall(this.manifest, call);
    const query = new URLSearchParams();
    if (call.rev !== undefined) query.set('rev', call.rev);
    if (call.view !== undefined) query.set('view', call.view);
    for (const v of call.include ?? []) query.append('include', v);
    for (const v of call.omit ?? []) query.append('omit', v);
    for (const [k, v] of Object.entries(call.params ?? {})) query.set(k, v);
    const qs = query.toString();
    const url = `${this.target.baseUrl}${this.target.basePath}${encodePath(call.path)}${qs ? `?${qs}` : ''}`;
    const body = call.body === undefined ? undefined : JSON.stringify(call.body);

    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        url,
        {
          method: call.method,
          agent: pinnedAgent(this.target.pin, this.target.caPem),
          headers: {
            authorization: `Bearer ${call.token}`,
            accept: 'application/json',
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...(call.reqId ? { 'x-request-id': call.reqId } : {}),
          },
        },
        (res) => {
          readJson(res).then(
            ({ status, data }) => {
              if (status >= 400) {
                const detail =
                  typeof data === 'object' && data !== null
                    ? String(
                        (data as Record<string, unknown>).message ??
                          (data as Record<string, unknown>).detail ??
                          (data as Record<string, unknown>).title ??
                          `switch answered ${status}`,
                      )
                    : `switch answered ${status}`;
                reject(new NvueError(status, call.method, call.path, detail));
                return;
              }
              resolve({ status, data });
            },
            (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
          );
        },
      );
      req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('switch request timed out')));
      req.on('error', reject);
      if (body === undefined) req.end();
      else req.end(body);
    });
  }
}
