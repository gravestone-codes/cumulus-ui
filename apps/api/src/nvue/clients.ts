/**
 * One NvueClient per (user, switch): inventory supplies the address + TOFU pin,
 * UserSwitchSession supplies the user's JWT, the manifest supplies the gate.
 * Shared by every Phase 1 workflow — callers never construct clients directly.
 */
import manifestJson from '@cumulus/spec/manifest.json' with { type: 'json' };
import { getSwitch } from '../inventory/store.js';
import { getSwitchToken, setSwitchToken } from '../switchauth/sessions.js';
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
