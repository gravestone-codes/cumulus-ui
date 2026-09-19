/**
 * RBAC routes (roadmap 0.8: R2c/R2d). Role management is bootstrapped by the
 * STORED `app-admin` role — the first holder is seeded by the create-admin CLI.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { resolveCaller } from '../auth/caller.js';
import { requireAppAdmin } from '../users/routes.js';
import { capabilities, createRole, deleteRole, getUserRoles, grantRole, listRoles } from './store.js';

export interface RbacDeps {
  cfg: AuthConfig;
}

export async function rbacRoutes(app: FastifyInstance, deps: RbacDeps): Promise<void> {
  const { cfg } = deps;

  app.get('/api/v1/roles', async (request, reply) => {
    const admin = await requireAppAdmin(request, reply, cfg);
    if (!admin) return reply;
    return listRoles();
  });

  app.post('/api/v1/roles', async (request, reply) => {
    const admin = await requireAppAdmin(request, reply, cfg);
    if (!admin) return reply;
    try {
      const role = await createRole(request.body);
      return reply.code(201).send(role);
    } catch (err) {
      if (err instanceof z.ZodError)
        return problem(reply, 400, 'Bad Request', 'invalid role body', request.url);
      if ((err as { code?: string }).code === 'ROLE_TAKEN') {
        return problem(reply, 409, 'Conflict', 'role id taken or reserved', request.url);
      }
      if ((err as { code?: string }).code === '23503') {
        return problem(reply, 400, 'Bad Request', 'referenced group does not exist', request.url);
      }
      throw err;
    }
  });

  app.delete('/api/v1/roles/:id', async (request, reply) => {
    const admin = await requireAppAdmin(request, reply, cfg);
    if (!admin) return reply;
    const { id } = request.params as { id: string };
    const outcome = await deleteRole(id);
    if (outcome === 'missing') return problem(reply, 404, 'Not Found', `no role ${id}`, request.url);
    if (outcome === 'system')
      return problem(reply, 409, 'Conflict', 'system roles are immutable', request.url);
    return { ok: true };
  });

  const GrantBody = z.object({ user_sub: z.string().min(1), role_id: z.string().min(1) });

  app.post('/api/v1/roles/grant', async (request, reply) => {
    const admin = await requireAppAdmin(request, reply, cfg);
    if (!admin) return reply;
    const parsed = GrantBody.safeParse(request.body);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'user_sub and role_id required', request.url);
    try {
      await grantRole(parsed.data.user_sub, parsed.data.role_id);
      return { ok: true };
    } catch (err) {
      if ((err as { code?: string }).code === '23503') {
        return problem(reply, 400, 'Bad Request', 'unknown role id', request.url);
      }
      throw err;
    }
  });

  app.get('/api/v1/me/capabilities', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const stored = await getUserRoles(who.sub);
    return { user: who.sub, ...capabilities(stored) };
  });
}
