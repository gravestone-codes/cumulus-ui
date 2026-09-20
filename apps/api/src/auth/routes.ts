/**
 * Auth routes: platform login over username + password (scrypt, constant-time).
 * Sessions are opaque cookies; roles are read fresh from the DB on every call.
 * No IdP, no redirects — users are created in our own UI (or the create-admin CLI).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from './config.js';
import { createSession, deleteSession, getSession } from './session.js';
import { verifyUser, getUserById } from '../users/store.js';
import { dropUserTokens } from '../switchauth/sessions.js';
import { getUserRoles } from '../rbac/store.js';
import { audit } from '../audit/store.js';

export const COOKIE = 'cumulus_session';

export interface AuthDeps {
  cfg: AuthConfig;
}

const LoginBody = z.object({ username: z.string().min(1), password: z.string().min(1) });

export async function authRoutes(app: FastifyInstance, deps: AuthDeps): Promise<void> {
  const { cfg } = deps;

  app.post('/api/v1/auth/login', async (request, reply) => {
    const parsed = LoginBody.safeParse(request.body);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'username and password required', request.url);
    const user = await verifyUser(parsed.data.username, parsed.data.password);
    if (!user)
      return problem(reply, 401, 'Unauthorized', 'invalid credentials or disabled account', request.url);
    const session = await createSession({ sub: user.id, username: user.display_name });
    const stored = await getUserRoles(user.id);
    await audit({
      userSub: user.id,
      username: user.display_name,
      roles: stored.map((r) => r.id),
      method: 'POST',
      path: request.url,
    });
    void reply.setCookie(COOKIE, session.id, {
      httpOnly: true,
      sameSite: 'strict',
      // Secure only when the browser-facing scheme is actually HTTPS.
      // Tying this to NODE_ENV broke production-over-HTTP LANs: browsers
      // silently drop Secure cookies on http:// and every later call 401s.
      secure: request.protocol === 'https',
      path: '/',
      maxAge: cfg.idleMinutes * 60,
    });
    return { user: { id: user.id, display_name: user.display_name } };
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
    const stored = await getUserRoles(session.identity.sub);
    const user = await getUserById(session.identity.sub);
    if (!user) return problem(reply, 401, 'Unauthorized', 'account removed', request.url);
    return {
      user: { id: user.id, username: user.id, display_name: user.display_name },
      roles: stored.map((r) => r.id),
    };
  });
}
