/**
 * Per-user per-switch JWT holder (roadmap 0.6: UserSwitchSession).
 * Memory-only by construction: a process-local Map, no persistence path.
 * The switch password lives only for the seconds a mint takes — it is never
 * stored here, only the resulting JWT. Expired JWTs evaporate on read;
 * re-minting needs the password again (UI re-prompts, 401 SWITCH_AUTH_REQUIRED).
 */
import { decodeJwt } from 'jose';

interface Entry {
  jwt: string;
  /** Epoch seconds; 0 when the token carries no exp. */
  exp: number;
}

const store = new Map<string, Entry>();
const SKEW_SECONDS = 30;

function key(userSub: string, switchId: string): string {
  return JSON.stringify([userSub, switchId]);
}

/** Seconds-since-epoch expiry decoded without verification (we present, not trust, this token). */
export function expiryOf(jwt: string): number {
  try {
    return decodeJwt(jwt).exp ?? 0;
  } catch {
    return 0;
  }
}

/** Store a freshly minted JWT. Overwrites any previous entry for the pair. */
export function setSwitchToken(userSub: string, switchId: string, jwt: string): void {
  store.set(key(userSub, switchId), { jwt, exp: expiryOf(jwt) });
}

/** Get a live JWT, or null when missing/expired (expired entries are dropped). */
export function getSwitchToken(userSub: string, switchId: string): string | null {
  const entry = store.get(key(userSub, switchId));
  if (!entry) return null;
  if (entry.exp !== 0 && entry.exp - SKEW_SECONDS <= Date.now() / 1000) {
    store.delete(key(userSub, switchId));
    return null;
  }
  return entry.jwt;
}

/** Drop one pair (switch logout). */
export function dropSwitchToken(userSub: string, switchId: string): void {
  store.delete(key(userSub, switchId));
}

/** Drop everything for a user (app logout). */
export function dropUserTokens(userSub: string): void {
  const prefix = JSON.stringify([userSub]).slice(0, -1);
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

/** Test hook: current entry count. */
export function switchTokenCount(): number {
  return store.size;
}
