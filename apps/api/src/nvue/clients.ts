/**
 * One NvueClient per (user, switch): inventory supplies the address + TOFU pin,
 * UserSwitchSession supplies the user's JWT, the manifest supplies the gate.
 * Shared by every Phase 1 workflow — callers never construct clients directly.
 */
import manifestJson from '@cumulus/spec/manifest.json' with { type: 'json' };
import { getSwitch } from '../inventory/store.js';
import { getSwitchToken } from '../switchauth/sessions.js';
import { NvueClient } from './client.js';

export interface SwitchClient {
  client: NvueClient;
  switchId: string;
}

/** Raw token for call sites that drive revisions.ts directly. Throws like clientFor when absent. */
export function tokenFor(userSub: string, switchId: string): string {
  const token = getSwitchToken(userSub, switchId);
  if (!token)
    throw Object.assign(new Error('switch session expired — reconnect'), {
      status: 401,
      code: 'SWITCH_AUTH_REQUIRED',
    });
  return token;
}
export async function clientFor(userSub: string, switchId: string): Promise<SwitchClient> {
  const sw = await getSwitch(switchId);
  if (!sw) throw Object.assign(new Error(`no switch ${switchId}`), { status: 404 });
  if (!sw.enabled) throw Object.assign(new Error(`switch ${switchId} is disabled`), { status: 409 });
  if (!sw.cert_fingerprint || !sw.cert_pem) {
    throw Object.assign(new Error(`switch ${switchId} predates certificate storage — re-enrol it`), {
      status: 409,
    });
  }
  const token = getSwitchToken(userSub, switchId);
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
  };
}
