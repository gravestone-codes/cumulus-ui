/**
 * Workflow routes (roadmap Phase 1): branch lifecycle + staging.
 * Staging gates on the STAGED method/path (proxy-equivalent check), snapshots
 * the operational before-image for OCC, PATCHes the user's branch, and audits.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { resolveCaller } from '../auth/caller.js';
import { gateCheck, getUserRoles, mayAccessSwitch } from '../rbac/store.js';
import { audit } from '../audit/store.js';
import { clientFor, tokenFor } from '../nvue/clients.js';
import { getSwitch } from '../inventory/store.js';
import { BranchConflictError, discardBranch, getEditSession, openBranch } from './branches.js';
import { heartbeat, presentOthers } from './presence.js';
import { applySession, OverlapError, collectDiffs } from './apply.js';
import { getAction } from '../nvue/revisions.js';
import { runAction } from './actions.js';
import { GuardError } from '../nvue/guard.js';
import { stageChange, StageError } from './stage.js';
import { fanoutApply, fanoutStage } from './fanout.js';

export interface WorkflowDeps {
  cfg: AuthConfig;
}

const StageBody = z.object({
  path: z.string().min(1),
  method: z.enum(['PATCH', 'DELETE']),
  body: z.record(z.string(), z.unknown()).optional(),
});

/** Map switch/gate failures to problems. Anything else is a real 500. */
function switchProblem(reply: FastifyReply, err: unknown, url: string) {
  if (err instanceof GuardError) return problem(reply, 400, 'Bad Request', err.message, url);
  const status = (err as { status?: number }).status;
  if (status === 401 || status === 404 || status === 409) {
    return problem(
      reply,
      status,
      status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Conflict',
      (err as Error).message,
      url,
    );
  }
  throw err;
}

export async function workflowRoutes(app: FastifyInstance, deps: WorkflowDeps): Promise<void> {
  const { cfg } = deps;

  app.post('/api/v1/switches/:id/branch', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id } = request.params as { id: string };
    const sw = await getSwitch(id);
    if (!sw) return problem(reply, 404, 'Not Found', `no switch ${id}`, request.url);
    const roles = await getUserRoles(who.sub);
    if (!mayAccessSwitch(roles, sw.groups)) {
      return problem(reply, 403, 'Forbidden', `no role covers switch ${id}`, request.url);
    }
    try {
      const session = await openBranch(who.sub, id);
      const stored = await getUserRoles(who.sub);
      await audit({
        userSub: who.sub,
        username: who.username,
        roles: stored.map((r) => r.id),
        switchId: id,
        method: 'POST',
        path: request.url,
        after: { branch: session.branch },
      });
      return session;
    } catch (err) {
      if (err instanceof BranchConflictError) {
        return problem(reply, 409, 'Conflict', err.message, request.url);
      }
      throw err;
    }
  });

  app.get('/api/v1/switches/:id/branch', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id } = request.params as { id: string };
    return (await getEditSession(who.sub, id)) ?? { branch: null };
  });

  app.delete('/api/v1/switches/:id/branch', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id } = request.params as { id: string };
    const result = await discardBranch(who.sub, id);
    const stored = await getUserRoles(who.sub);
    await audit({
      userSub: who.sub,
      username: who.username,
      roles: stored.map((r) => r.id),
      switchId: id,
      method: 'DELETE',
      path: request.url,
    });
    return result;
  });

  app.post('/api/v1/switches/:id/stage', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = StageBody.safeParse(request.body);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'path + PATCH|DELETE method required', request.url);
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const sw = await getSwitch(id);
    if (!sw) return problem(reply, 404, 'Not Found', `no switch ${id}`, request.url);
    const roles = await getUserRoles(who.sub);
    try {
      const result = await stageChange({ sub: who.sub, username: who.username, roles }, sw, {
        path: parsed.data.path,
        method: parsed.data.method,
        body: parsed.data.body,
      });
      return { ok: true, ...result };
    } catch (err) {
      if (err instanceof StageError) {
        return problem(
          reply,
          err.status,
          err.status === 403 ? 'Forbidden' : 'Conflict',
          err.message,
          request.url,
        );
      }
      return switchProblem(reply, err, request.url);
    }
  });

  app.post('/api/v1/switches/:id/presence', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id } = request.params as { id: string };
    const parsed = z.object({ path: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'path required', request.url);
    await heartbeat(who.sub, who.username, id, parsed.data.path);
    return { ok: true };
  });

  app.get('/api/v1/switches/:id/presence', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id } = request.params as { id: string };
    return presentOthers(who.sub, id);
  });

  app.post('/api/v1/switches/:id/apply', async (request, reply) => {
    const { id } = request.params as { id: string };
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const sw = await getSwitch(id);
    if (!sw) return problem(reply, 404, 'Not Found', `no switch ${id}`, request.url);
    const roles = await getUserRoles(who.sub);
    const roleIds = roles.map((r) => r.id);
    // Applying needs the /config grant (matrix: operators stage, only admins apply).
    if (!gateCheck(roles, { method: 'POST', path: '/config', switchGroups: sw.groups })) {
      await audit({
        userSub: who.sub,
        username: who.username,
        roles: roleIds,
        switchId: id,
        method: 'POST',
        path: request.url,
      });
      return problem(reply, 403, 'Forbidden', 'apply not granted — POST /config required', request.url);
    }
    try {
      return await applySession({ sub: who.sub, username: who.username, roleIds }, id);
    } catch (err) {
      if (err instanceof OverlapError) {
        return reply.code(409).send({
          type: 'about:blank',
          title: 'Conflict',
          status: 409,
          detail: err.message,
          conflicts: err.conflicts,
        });
      }
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 404 || status === 409) {
        return problem(
          reply,
          status,
          status === 401 ? 'Unauthorized' : status === 404 ? 'Not Found' : 'Conflict',
          (err as Error).message,
          request.url,
        );
      }
      return switchProblem(reply, err, request.url);
    }
  });

  app.get('/api/v1/switches/:id/jobs/:jobId', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id, jobId } = request.params as { id: string; jobId: string };
    try {
      const { client } = await clientFor(who.sub, id);
      const job = await getAction(client, tokenFor(who.sub, id), jobId);
      return job;
    } catch (err) {
      return switchProblem(reply, err, request.url);
    }
  });

  app.post('/api/v1/switches/:id/action', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z
      .object({ path: z.string().min(1), body: z.record(z.string(), z.unknown()).optional() })
      .safeParse(request.body);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'action path required', request.url);
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const sw = await getSwitch(id);
    if (!sw) return problem(reply, 404, 'Not Found', `no switch ${id}`, request.url);
    const roles = await getUserRoles(who.sub);
    const roleIds = roles.map((r) => r.id);
    if (!mayAccessSwitch(roles, sw.groups)) {
      await audit({
        userSub: who.sub,
        username: who.username,
        roles: roleIds,
        method: 'POST',
        path: request.url,
      });
      return problem(reply, 403, 'Forbidden', `no role covers switch ${id}`, request.url);
    }
    if (!gateCheck(roles, { method: 'POST', path: parsed.data.path, switchGroups: sw.groups })) {
      await audit({
        userSub: who.sub,
        username: who.username,
        roles: roleIds,
        method: 'POST',
        path: request.url,
      });
      return problem(reply, 403, 'Forbidden', 'not granted by any role', request.url);
    }
    try {
      return await runAction(
        { sub: who.sub, username: who.username, roleIds },
        id,
        parsed.data.path,
        parsed.data.body,
      );
    } catch (err) {
      return switchProblem(reply, err, request.url);
    }
  });

  app.get('/api/v1/switches/:id/diff', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id } = request.params as { id: string };
    const session = await getEditSession(who.sub, id);
    if (!session) return problem(reply, 409, 'Conflict', 'no open branch — open one first', request.url);
    try {
      const { client } = await clientFor(who.sub, id);
      const diffs = await collectDiffs(client, tokenFor(who.sub, id), session.staged);
      return { branch: session.branch, baseRev: session.baseRev, diffs };
    } catch (err) {
      return switchProblem(reply, err, request.url);
    }
  });

  const FanoutBody = z.object({
    path: z.string().min(1),
    method: z.enum(['PATCH', 'DELETE']),
    body: z.record(z.string(), z.unknown()).optional(),
  });

  app.post('/api/v1/groups/:gid/stage', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { gid } = request.params as { gid: string };
    const parsed = FanoutBody.safeParse(request.body);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'path + PATCH|DELETE method required', request.url);
    const roles = await getUserRoles(who.sub);
    if (!gateCheck(roles, { method: 'POST', path: request.url })) {
      await audit({
        userSub: who.sub,
        username: who.username,
        roles: roles.map((r) => r.id),
        method: 'POST',
        path: request.url,
      });
      return problem(reply, 403, 'Forbidden', 'not granted by any role', request.url);
    }
    const results = await fanoutStage({ sub: who.sub, username: who.username, roles }, gid, {
      path: parsed.data.path,
      method: parsed.data.method,
      body: parsed.data.body,
    });
    return { results };
  });

  app.post('/api/v1/groups/:gid/apply', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { gid } = request.params as { gid: string };
    const roles = await getUserRoles(who.sub);
    if (!gateCheck(roles, { method: 'POST', path: request.url })) {
      await audit({
        userSub: who.sub,
        username: who.username,
        roles: roles.map((r) => r.id),
        method: 'POST',
        path: request.url,
      });
      return problem(reply, 403, 'Forbidden', 'not granted by any role', request.url);
    }
    const results = await fanoutApply({ sub: who.sub, username: who.username, roles }, gid);
    return { results };
  });
}
