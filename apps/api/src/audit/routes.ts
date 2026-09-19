/**
 * Audit read endpoint (roadmap 0.9). First real consumer of PermissionGate:
 * the caller's stored roles decide, deny-by-default. Filters keep reads
 * scoped; limit is capped.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { resolveCaller } from '../auth/caller.js';
import { gateCheck } from '../rbac/store.js';
import { getUserRoles } from '../rbac/store.js';
import { db } from '../db.js';

const Query = z.object({
  switch: z.string().optional(),
  user: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function auditRoutes(app: FastifyInstance, deps: { cfg: AuthConfig }): Promise<void> {
  app.get('/api/v1/audit', async (request, reply) => {
    const who = await resolveCaller(request, deps.cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const roles = await getUserRoles(who.sub);
    if (!gateCheck(roles, { method: 'GET', path: '/api/v1/audit' })) {
      return problem(reply, 403, 'Forbidden', 'audit read not granted', request.url);
    }
    const parsed = Query.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'bad filters', request.url);
    const { switch: sw, user, limit } = parsed.data;
    const conds: string[] = [];
    const args: string[] = [];
    if (sw) {
      args.push(sw);
      conds.push(`switch_id = $${args.length}`);
    }
    if (user) {
      args.push(user);
      conds.push(`user_sub = $${args.length}`);
    }
    args.push(String(limit));
    const { rows } = await db().query(
      `SELECT id, ts, user_sub, username, roles, switch_id, method, path, before, after, rev, job_id, hash
       FROM audit_log ${conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY id DESC LIMIT $${args.length}`,
      args,
    );
    return rows;
  });
}
