/**
 * Auth routes (roadmap 0.5). BFF pattern: the SPA sends Keycloak tokens once;
 * the backend verifies, mints an opaque session, and speaks cookie-only after.
 * Silent refresh rotates server-side; idle/dead sessions answer 401 → UI re-login.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from './config.js';
import { verifyAccessToken, type KeyProvider } from './oidc.js';
import { createSession, deleteSession, getSession, refreshSession } from './session.js';
import { dropUserTokens } from '../switchauth/sessions.js';
import { getUserRoles } from '../rbac/store.js';
import { audit } from '../audit/store.js';

export const COOKIE = 'cumulus_session';

export interface AuthDeps {
  cfg: AuthConfig;
  keys?: KeyProvider;
  refreshFetch?: typeof fetch;
}

const LoginBody = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1) });

function setCookie(reply: FastifyReply, id: string, cfg: AuthConfig) {
  void reply.setCookie(COOKIE, id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: cfg.idleMinutes * 60,
  });
}

export async function authRoutes(app: FastifyInstance, deps: AuthDeps): Promise<void> {
  const { cfg, keys, refreshFetch } = deps;

  app.post('/api/v1/auth/login', async (request, reply) => {
    const parsed = LoginBody.safeParse(request.body);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'access_token and refresh_token required', request.url);
    try {
      const identity = await verifyAccessToken(parsed.data.access_token, cfg, keys);
      const session = await createSession(identity, parsed.data.refresh_token, cfg);
      const stored = await getUserRoles(identity.sub);
      await audit({
        userSub: identity.sub,
        username: identity.username,
        roles: stored.map((r) => r.id),
        method: 'POST',
        path: request.url,
      });
      setCookie(reply, session.id, cfg);
      return { user: identity };
    } catch {
      return problem(reply, 401, 'Unauthorized', 'invalid Keycloak token', request.url);
    }
  });

  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const id = request.cookies?.[COOKIE];
    if (!id) return problem(reply, 401, 'Unauthorized', 'no session', request.url);
    try {
      const { identity, expiresIn } = await refreshSession(id, cfg, refreshFetch, keys);
      setCookie(reply, id, cfg);
      return { user: identity, expiresIn };
    } catch {
      await deleteSession(id);
      return problem(reply, 401, 'Unauthorized', 'refresh failed — re-login required', request.url);
    }
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const id = request.cookies?.[COOKIE];
    if (id) {
      const session = await getSession(id, cfg);
      if (session) {
        const stored = await getUserRoles(session.identity.sub);
        await audit({
          userSub: session.identity.sub,
          username: session.identity.username,
          roles: stored.map((r) => r.id),
          method: 'POST',
          path: request.url,
        });
        dropUserTokens(session.identity.sub);
      }
      await deleteSession(id);
    }
    void reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/v1/auth/me', async (request, reply) => {
    const id = request.cookies?.[COOKIE];
    const session = id ? await getSession(id, cfg) : null;
    if (!session) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    return { user: session.identity };
  });
}
