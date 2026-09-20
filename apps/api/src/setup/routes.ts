/**
 * First-boot setup (roadmap §8) + dev-only reset.
 * Setup endpoints are public BUT gated on emptiness: the moment one user
 * exists, POST /admin 404s forever. The reset endpoint is worse than public —
 * it exists only outside production (refused at registration in prod).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { createSession } from '../auth/session.js';
import { createUser } from '../users/store.js';
import { grantRole } from '../rbac/store.js';
import { audit } from '../audit/store.js';
import { db } from '../db.js';

export interface SetupDeps {
  cfg: AuthConfig;
}

const AdminBody = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9._-]+$/i),
  display_name: z.string().min(1).max(128),
  password: z.string().min(12).max(256),
});

async function userCount(): Promise<number> {
  const { rows } = await db().query<{ count: string }>('SELECT count(*) FROM users');
  return Number(rows[0]?.count ?? 0);
}

export async function setupRoutes(app: FastifyInstance, deps: SetupDeps): Promise<void> {
  const { cfg } = deps;

  app.get('/api/v1/setup/status', async () => ({ initialized: (await userCount()) > 0 }));

  app.post('/api/v1/setup/admin', async (request, reply) => {
    if ((await userCount()) > 0) {
      return problem(reply, 404, 'Not Found', 'system already initialized — log in', request.url);
    }
    const parsed = AdminBody.safeParse(request.body);
    if (!parsed.success)
      return problem(
        reply,
        400,
        'Bad Request',
        'id, display_name and password (min 12) required',
        request.url,
      );
    try {
      const user = await createUser({
        id: parsed.data.id,
        display_name: parsed.data.display_name,
        password: parsed.data.password,
      });
      await grantRole(user.id, 'app-admin');
      const session = await createSession({ sub: user.id, username: user.display_name });
      await audit({
        userSub: user.id,
        username: user.display_name,
        roles: ['app-admin'],
        method: 'POST',
        path: request.url,
        after: { id: user.id },
      });
      void reply.setCookie('cumulus_session', session.id, {
        httpOnly: true,
        sameSite: 'strict',
        // Scheme-based, not env-based (see auth/routes.ts): Secure on http://
        // makes browsers silently drop the cookie.
        secure: request.protocol === 'https',
        path: '/',
        maxAge: cfg.idleMinutes * 60,
      });
      return { user: { id: user.id, display_name: user.display_name } };
    } catch (err) {
      if ((err as { code?: string }).code === 'USER_TAKEN') {
        return problem(reply, 409, 'Conflict', 'user id taken', request.url);
      }
      throw err;
    }
  });

  // DEV ONLY — never registered in production (see app.ts). Wipes all app
  // state back to migrations baseline (system roles/rules survive) so the
  // initial onboarding can be re-tested endlessly. Typed-confirm in the UI.
  if (process.env.NODE_ENV !== 'production') {
    app.post('/api/v1/dev/reset', async () => {
      const pool = db();
      await pool.query('DELETE FROM audit_log');
      await pool.query('DELETE FROM presence');
      await pool.query('DELETE FROM edit_sessions');
      await pool.query('DELETE FROM sessions');
      await pool.query('DELETE FROM switch_credentials');
      await pool.query('DELETE FROM user_roles');
      await pool.query('DELETE FROM switch_groups');
      await pool.query('DELETE FROM switches');
      await pool.query('DELETE FROM groups');
      await pool.query(`DELETE FROM role_rules WHERE role_id NOT IN (SELECT id FROM roles WHERE system)`);
      await pool.query('DELETE FROM roles WHERE system = false');
      await pool.query('DELETE FROM users');
      return { ok: true, reset: true };
    });
  }
}
