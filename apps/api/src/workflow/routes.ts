/**
 * Workflow routes (roadmap Phase 1): branch lifecycle + staging.
 * Staging gates on the STAGED method/path (proxy-equivalent check), snapshots
 * the operational before-image for OCC, PATCHes the user's branch, and audits.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { resolveCaller } from '../auth/caller.js';
import { gateCheck, getUserRoles, mayAccessSwitch, type Role } from '../rbac/store.js';
import { audit, redact } from '../audit/store.js';
import { withSwitchToken } from '../nvue/clients.js';
import { getSwitch, markSeen } from '../inventory/store.js';
import { BranchConflictError, discardBranch, getEditSession, openBranch } from './branches.js';
import { heartbeat, overlaps, presentOthers } from './presence.js';
import { applySession, OverlapError, collectDiffs } from './apply.js';
import { getAction } from '../nvue/revisions.js';
import { runAction } from './actions.js';
import { GuardError } from '../nvue/guard.js';
import { stageChange, StageError } from './stage.js';
import { fanoutAction, fanoutApply, fanoutQuery, fanoutRebase, fanoutStage } from './fanout.js';
import { rebaseSession } from './rebase.js';

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
      const session = await openBranch(who.sub, id, { credKey: cfg.credKey });
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
    const result = await discardBranch(who.sub, id, { credKey: cfg.credKey });
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
      const result = await stageChange(
        { sub: who.sub, username: who.username, roles, credKey: cfg.credKey },
        sw,
        {
          path: parsed.data.path,
          method: parsed.data.method,
          body: parsed.data.body,
        },
      );
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

  /** Switch exists and some role covers it; denials are audited. Null = problem already sent. */
  async function coveredSwitch(
    request: FastifyRequest,
    reply: FastifyReply,
    who: { sub: string; username: string },
    id: string,
  ): Promise<{ roles: Role[]; groups: string[] } | null> {
    const sw = await getSwitch(id);
    if (!sw) {
      problem(reply, 404, 'Not Found', `no switch ${id}`, request.url);
      return null;
    }
    const roles = await getUserRoles(who.sub);
    if (mayAccessSwitch(roles, sw.groups)) return { roles, groups: sw.groups };
    await audit({
      userSub: who.sub,
      username: who.username,
      roles: roles.map((r) => r.id),
      switchId: id,
      method: request.method,
      path: request.url,
    });
    problem(reply, 403, 'Forbidden', `no role covers switch ${id}`, request.url);
    return null;
  }

  app.post('/api/v1/switches/:id/presence', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id } = request.params as { id: string };
    const parsed = z.object({ path: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'path required', request.url);
    if (!(await coveredSwitch(request, reply, who, id))) return reply;
    await heartbeat(who.sub, who.username, id, parsed.data.path);
    return { ok: true };
  });

  app.get('/api/v1/switches/:id/presence', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id } = request.params as { id: string };
    const parsed = z.object({ path: z.string().min(1).optional() }).safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'path must be a string', request.url);
    if (!(await coveredSwitch(request, reply, who, id))) return reply;
    return presentOthers(who.sub, id, parsed.data.path);
  });

  // Another user's unapplied staged changes, read-only (R19 "view their changes").
  // Served from their stored intents, each path gated as a GET for the caller; secrets redacted.
  app.get('/api/v1/switches/:id/presence/:user/staged', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id, user } = request.params as { id: string; user: string };
    const parsed = z.object({ path: z.string().min(1).optional() }).safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'path must be a string', request.url);
    const covered = await coveredSwitch(request, reply, who, id);
    if (!covered) return reply;
    const session = await getEditSession(user, id);
    const { path } = parsed.data;
    const diffs = (session?.staged ?? [])
      .filter((s) => path === undefined || overlaps(s.path, path))
      .filter((s) => gateCheck(covered.roles, { method: 'GET', path: s.path, switchGroups: covered.groups }))
      .map((s) => ({
        path: s.path,
        method: s.method,
        before: redact(s.before),
        mine: redact(s.after ?? null),
      }));
    if (!session || diffs.length === 0) {
      return problem(reply, 404, 'Not Found', `no staged changes by ${user} on ${id}`, request.url);
    }
    return { branch: session.branch, baseRev: session.baseRev, diffs };
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
      return await applySession({ sub: who.sub, username: who.username, roleIds, credKey: cfg.credKey }, id);
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

  // Stale draft → fresh branch off current applied, same intents re-staged (roadmap 4.5).
  app.post('/api/v1/switches/:id/rebase', async (request, reply) => {
    const { id } = request.params as { id: string };
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const sw = await getSwitch(id);
    if (!sw) return problem(reply, 404, 'Not Found', `no switch ${id}`, request.url);
    const roles = await getUserRoles(who.sub);
    try {
      return await rebaseSession({ sub: who.sub, username: who.username, roles, credKey: cfg.credKey }, sw);
    } catch (err) {
      if (err instanceof StageError) {
        if (err.status === 403) {
          await audit({
            userSub: who.sub,
            username: who.username,
            roles: roles.map((r) => r.id),
            switchId: id,
            method: 'POST',
            path: request.url,
          });
        }
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

  app.get('/api/v1/switches/:id/jobs/:jobId', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id, jobId } = request.params as { id: string; jobId: string };
    try {
      const job = await withSwitchToken(who.sub, id, { credKey: cfg.credKey }, (client, token) =>
        getAction(client, token, jobId),
      );
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
        { sub: who.sub, username: who.username, roleIds, credKey: cfg.credKey },
        id,
        parsed.data.path,
        parsed.data.body,
      );
    } catch (err) {
      return switchProblem(reply, err, request.url);
    }
  });

  app.post('/api/v1/switches/:id/verify', async (request, reply) => {
    // Session-only like diff/presence: the ceremony already gates enrolment and
    // credentials; this is a read-only proof-of-life. Config writes stay gated.
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id } = request.params as { id: string };
    const sw = await getSwitch(id);
    if (!sw) return problem(reply, 404, 'Not Found', `no switch ${id}`, request.url);
    try {
      const res = await withSwitchToken(who.sub, id, { credKey: cfg.credKey }, (client, token) =>
        client.call({ path: '/system', method: 'GET', token }),
      );
      const { data } = res;
      await markSeen(id, true);
      return { ok: true, switch: id, data };
    } catch (err) {
      await markSeen(id, false);
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
      const diffs = await withSwitchToken(who.sub, id, { credKey: cfg.credKey }, (client, token) =>
        collectDiffs(client, token, session.staged),
      );
      return { branch: session.branch, baseRev: session.baseRev, diffs };
    } catch (err) {
      return switchProblem(reply, err, request.url);
    }
  });

  const Body = z.record(z.string(), z.unknown());
  const Members = z.array(z.string().min(1)).min(1).max(256).optional();
  const FanoutBody = z
    .object({
      path: z.string().min(1),
      method: z.enum(['PATCH', 'DELETE']),
      body: Body.optional(),
      /** Per-switch bodies for per-switch-unique values; keys are the members touched. */
      bodies: z.record(z.string(), Body).optional(),
      members: Members,
      exclusive: z.boolean().optional(),
    })
    .refine((b) => b.method === 'DELETE' || b.body !== undefined || b.bodies !== undefined, {
      message: 'PATCH needs body or bodies',
    });

  /** Our-API gate for a group route; denials are audited. True = problem already sent. */
  async function denyGroupRoute(
    request: FastifyRequest,
    reply: FastifyReply,
    who: { sub: string; username: string },
    roles: Role[],
    method: 'GET' | 'POST',
  ): Promise<boolean> {
    const path = request.url.split('?')[0] ?? request.url;
    if (gateCheck(roles, { method, path })) return false;
    await audit({
      userSub: who.sub,
      username: who.username,
      roles: roles.map((r) => r.id),
      method,
      path: request.url,
    });
    problem(reply, 403, 'Forbidden', 'not granted by any role', request.url);
    return true;
  }

  app.post('/api/v1/groups/:gid/stage', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { gid } = request.params as { gid: string };
    const parsed = FanoutBody.safeParse(request.body);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'path + PATCH|DELETE method required', request.url);
    const roles = await getUserRoles(who.sub);
    if (await denyGroupRoute(request, reply, who, roles, 'POST')) return reply;
    const { path, method, body, bodies, members, exclusive } = parsed.data;
    const results = await fanoutStage(
      { sub: who.sub, username: who.username, roles, credKey: cfg.credKey },
      gid,
      { path, method, body, bodies },
      { members, exclusive },
    );
    return { results };
  });

  app.post('/api/v1/groups/:gid/apply', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { gid } = request.params as { gid: string };
    const parsed = z.object({ members: Members }).safeParse(request.body ?? {});
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'members must be switch ids', request.url);
    const roles = await getUserRoles(who.sub);
    if (await denyGroupRoute(request, reply, who, roles, 'POST')) return reply;
    const results = await fanoutApply(
      { sub: who.sub, username: who.username, roles, credKey: cfg.credKey },
      gid,
      { members: parsed.data.members },
    );
    return { results };
  });

  app.post('/api/v1/groups/:gid/rebase', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { gid } = request.params as { gid: string };
    const parsed = z.object({ members: Members }).safeParse(request.body ?? {});
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'members must be switch ids', request.url);
    const roles = await getUserRoles(who.sub);
    if (await denyGroupRoute(request, reply, who, roles, 'POST')) return reply;
    const results = await fanoutRebase(
      { sub: who.sub, username: who.username, roles, credKey: cfg.credKey },
      gid,
      { members: parsed.data.members },
    );
    return { results };
  });

  app.post('/api/v1/groups/:gid/action', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { gid } = request.params as { gid: string };
    const parsed = z
      .object({ path: z.string().min(1), body: Body.optional(), members: Members })
      .safeParse(request.body);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'action path required', request.url);
    const roles = await getUserRoles(who.sub);
    if (await denyGroupRoute(request, reply, who, roles, 'POST')) return reply;
    const results = await fanoutAction(
      { sub: who.sub, username: who.username, roles, credKey: cfg.credKey },
      gid,
      { path: parsed.data.path, body: parsed.data.body },
      { members: parsed.data.members },
    );
    return { results };
  });

  const GroupQuery = z.object({
    path: z.string().min(1),
    rev: z.string().min(1).optional(),
    view: z.string().min(1).optional(),
  });

  // Fan-out read for group screens: each member gated on its own groups,
  // one row each (ok + data, or status + error); a failed member never fails the read.
  app.get('/api/v1/groups/:gid/query', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { gid } = request.params as { gid: string };
    const parsed = GroupQuery.safeParse(request.query);
    if (!parsed.success) return problem(reply, 400, 'Bad Request', 'path query required', request.url);
    const roles = await getUserRoles(who.sub);
    if (await denyGroupRoute(request, reply, who, roles, 'GET')) return reply;
    const { results, denied } = await fanoutQuery(
      { sub: who.sub, roles, credKey: cfg.credKey },
      gid,
      parsed.data,
    );
    for (const switchId of denied) {
      await audit({
        userSub: who.sub,
        username: who.username,
        roles: roles.map((r) => r.id),
        switchId,
        method: 'GET',
        path: request.url,
      });
    }
    return { results };
  });
}
