/**
 * Generic NVUE read proxy (Phase 2: feeds ResourceList and every read view).
 * Dumb-UI rule: the UI passes a path; the backend validates (manifest gate),
 * authorizes (PermissionGate on the GET path + scope), and proxies with the
 * user's own switch JWT. Writes never come here (PATCH/DELETE → /stage,
 * POST actions → /action). Reads are not audited; denials are.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { resolveCaller } from '../auth/caller.js';
import { gateCheck, getUserRoles, mayAccessSwitch } from '../rbac/store.js';
import { audit } from '../audit/store.js';
import { getSwitch } from '../inventory/store.js';
import { clientFor, tokenFor } from '../nvue/clients.js';
import { GuardError } from '../nvue/guard.js';

const Query = z.object({
  path: z.string().min(1),
  rev: z.string().min(1).optional(),
  view: z.string().min(1).optional(),
});

export async function queryRoutes(app: FastifyInstance, deps: { cfg: AuthConfig }): Promise<void> {
  const { cfg } = deps;

  app.get('/api/v1/switches/:id/query', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id } = request.params as { id: string };
    const parsed = Query.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'path query required', request.url);
    const sw = await getSwitch(id);
    if (!sw) return problem(reply, 404, 'Not Found', `no switch ${id}`, request.url);
    const roles = await getUserRoles(who.sub);
    const roleIds = roles.map((r) => r.id);
    if (!mayAccessSwitch(roles, sw.groups)) {
      await audit({
        userSub: who.sub,
        username: who.username,
        roles: roleIds,
        switchId: id,
        method: 'GET',
        path: request.url,
      });
      return problem(reply, 403, 'Forbidden', `no role covers switch ${id}`, request.url);
    }
    if (!gateCheck(roles, { method: 'GET', path: parsed.data.path, switchGroups: sw.groups })) {
      await audit({
        userSub: who.sub,
        username: who.username,
        roles: roleIds,
        switchId: id,
        method: 'GET',
        path: request.url,
      });
      return problem(reply, 403, 'Forbidden', 'not granted by any role', request.url);
    }
    try {
      const { client } = await clientFor(who.sub, id);
      const { data } = await client.call({
        path: parsed.data.path,
        method: 'GET',
        rev: parsed.data.rev,
        view: parsed.data.view,
        token: tokenFor(who.sub, id),
      });
      return { data };
    } catch (err) {
      if (err instanceof GuardError) return problem(reply, 400, 'Bad Request', err.message, request.url);
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 404) {
        return problem(
          reply,
          status,
          status === 401 ? 'Unauthorized' : 'Not Found',
          (err as Error).message,
          request.url,
        );
      }
      throw err;
    }
  });
}
