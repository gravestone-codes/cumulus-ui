/**
 * OIDC access-token verification (roadmap 0.5: HumanAuth).
 * Keycloak signs; we verify signature (JWKS), issuer, audience, expiry via jose.
 * Roles come from `realm_access` + `resource_access[clientId]`; groups from the
 * `groups` claim (needs a Keycloak group-membership client mapper — server config,
 * not code). Never trust claims the signature doesn't cover.
 */
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { type AuthConfig, issuerOf } from './config.js';

export interface Identity {
  sub: string;
  username: string;
  roles: string[];
  groups: string[];
}

/** Key provider seam: remote JWKS in prod, local set in tests. */
export type KeyProvider = (cfg: AuthConfig) => JWTVerifyGetKey;

export function remoteKeys(cfg: AuthConfig) {
  return createRemoteJWKSet(new URL(`${issuerOf(cfg)}/protocol/openid-connect/certs`));
}

/** Verify an access token. Throws on any failure — callers map to 401. */
export async function verifyAccessToken(
  token: string,
  cfg: AuthConfig,
  keys: KeyProvider = remoteKeys,
): Promise<Identity> {
  const { payload } = await jwtVerify(token, keys(cfg), {
    issuer: issuerOf(cfg),
    audience: cfg.clientId,
  });
  return toIdentity(payload, cfg.clientId);
}

/** Extract our identity shape from verified claims. Pure — unit-tested. */
export function toIdentity(payload: JWTPayload, clientId: string): Identity {
  const sub = payload.sub;
  if (!sub) throw new Error('token has no sub');
  const realmRoles = asStrings((payload.realm_access as { roles?: unknown } | undefined)?.roles);
  const clientRoles = asStrings(
    (payload.resource_access as Record<string, { roles?: unknown }> | undefined)?.[clientId]?.roles,
  );
  return {
    sub,
    username: typeof payload.preferred_username === 'string' ? payload.preferred_username : sub,
    roles: [...new Set([...realmRoles, ...clientRoles])],
    groups: asStrings(payload.groups),
  };
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** Build a local key provider for tests (no Keycloak needed). */
export function localKeys(jwks: { keys: unknown[] }) {
  return () => createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0]);
}
