/** Shared session-cookie caller resolution. Third use → promoted to shared (rule of three). */
import type { FastifyRequest } from 'fastify';
import { type AuthConfig } from './config.js';
import { getSession } from './session.js';
import { COOKIE } from './routes.js';

export interface Caller {
  sub: string;
  username: string;
  keycloakRoles: string[];
}

/** Resolve the caller from the session cookie. Null = anonymous. */
export async function resolveCaller(request: FastifyRequest, cfg: AuthConfig): Promise<Caller | null> {
  const id = request.cookies?.[COOKIE];
  const session = id ? await getSession(id, cfg) : null;
  if (!session) return null;
  return {
    sub: session.identity.sub,
    username: session.identity.username,
    keycloakRoles: session.identity.roles,
  };
}
