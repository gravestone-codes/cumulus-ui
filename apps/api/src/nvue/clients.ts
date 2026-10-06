/**
 * One NvueClient per (user, switch): inventory supplies the address + TOFU pin,
 * UserSwitchSession supplies the user's JWT, the manifest supplies the gate.
 * Shared by every Phase 1 workflow — callers never construct clients directly.
 */
import manifestJson from '@cumulus/spec/manifest.json' with { type: 'json' };
import { decodeJwt } from 'jose';
import { getSwitch } from '../inventory/store.js';
import { dropSwitchToken, getSwitchToken, setSwitchToken, switchTokenAgeMs } from '../switchauth/sessions.js';
import { getSwitchCredential } from '../users/store.js';
import { mintSwitchToken } from '../switchauth/routes.js';
import { NvueClient } from './client.js';

export interface SwitchClient {
  client: NvueClient;
  switchId: string;
  token: string;
}

/**
 * One client per (user, switch), with silent re-mint: an expired/missing
 * token is re-minted from the sealed credential before giving up, so reads
 * survive token expiry without another ceremony. Mint failures and absent
 * credentials throw 401 SWITCH_AUTH_REQUIRED exactly like before.
 */
export async function clientFor(
  userSub: string,
  switchId: string,
  opts?: { credKey?: string },
): Promise<SwitchClient> {
  const sw = await getSwitch(switchId);
  if (!sw) throw Object.assign(new Error(`no switch ${switchId}`), { status: 404 });
  if (!sw.enabled) throw Object.assign(new Error(`switch ${switchId} is disabled`), { status: 409 });
  if (!sw.cert_fingerprint || !sw.cert_pem) {
    throw Object.assign(new Error(`switch ${switchId} predates certificate storage — re-enrol it`), {
      status: 409,
    });
  }
  let token = getSwitchToken(userSub, switchId);
  if (!token && opts?.credKey) {
    const cred = await getSwitchCredential(userSub, switchId, opts.credKey).catch(() => null);
    if (cred && sw.cert_fingerprint && sw.cert_pem) {
      try {
        token = await mintSwitchToken(
          sw.base_url,
          sw.base_path,
          cred.switchUsername,
          cred.password,
          sw.cert_fingerprint,
          sw.cert_pem,
        );
        setSwitchToken(userSub, switchId, token);
      } catch {
        token = null;
      }
    }
  }
  if (!token)
    throw Object.assign(new Error('switch session expired — reconnect'), {
      status: 401,
      code: 'SWITCH_AUTH_REQUIRED',
    });
  const manifest = manifestJson as { routes: Record<string, string[]>; views: Record<string, string[]> };
  return {
    client: new NvueClient(
      { baseUrl: sw.base_url, basePath: sw.base_path, pin: sw.cert_fingerprint, caPem: sw.cert_pem },
      manifest,
    ),
    switchId,
    token,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits before retrying the SAME young token: honor the token's own nbf
 * when present, otherwise a short backoff. New tokens fail the same way,
 * so minting another one here would only burn time.
 */
async function graceWaits(token: string): Promise<number[]> {
  try {
    const claims = decodeJwt(token) as { nbf?: number };
    if (typeof claims.nbf === 'number') {
      const wait = claims.nbf * 1000 - Date.now() + 250;
      return wait > 0 ? [Math.min(wait, 3000)] : [];
    }
  } catch {
    /* opaque token: fixed backoff below */
  }
  return [250, 500, 1000];
}

function isSwitch401(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { status?: number }).status === 401;
}

/** Tokens younger than this get the grace rule; older ones are replaced. */
const GRACE_WINDOW_MS = 10_000;

/**
 * Run one switch operation with automatic token care: same-token grace
 * retries for brand-new tokens the switch isn't ready for, one re-mint for
 * genuinely dead ones. A 401 means the switch rejected the request before
 * doing anything, so retrying writes here is safe. Persistent 401s surface
 * unchanged for the UI's Reconnect path.
 */
export async function withSwitchToken<T>(
  userSub: string,
  switchId: string,
  opts: { credKey?: string },
  fn: (client: NvueClient, token: string) => Promise<T>,
): Promise<T> {
  async function attempt(client: NvueClient, token: string): Promise<T> {
    try {
      return await fn(client, token);
    } catch (err) {
      if (!isSwitch401(err)) throw err;
      const age = switchTokenAgeMs(userSub, switchId);
      if (age === null || age > GRACE_WINDOW_MS) throw err;
      for (const wait of await graceWaits(token)) {
        await sleep(wait);
        try {
          return await fn(client, token);
        } catch (retryErr) {
          if (!isSwitch401(retryErr)) throw retryErr;
          err = retryErr;
        }
      }
      throw err;
    }
  }

  const first = await clientFor(userSub, switchId, opts);
  try {
    return await attempt(first.client, first.token);
  } catch (err) {
    if (!isSwitch401(err)) throw err;
    dropSwitchToken(userSub, switchId);
    const fresh = await clientFor(userSub, switchId, opts);
    return attempt(fresh.client, fresh.token);
  }
}
