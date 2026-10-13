/**
 * Generic NVUE read proxy (Phase 2: feeds ResourceList and every read view).
 * Dumb-UI rule: the UI passes a path; the backend validates (manifest gate),
 * authorizes (PermissionGate on the GET path + scope), and proxies with the
 * user's own switch JWT. Writes never come here (PATCH/DELETE → /stage,
 * POST actions → /action). Reads are not audited; denials are.
 *
 * `/collect` is the same read fanned out over a collection's keys
 * (per-interface LLDP/ARP, per-VRF BGP, per-domain MACs): one browser call,
 * every member path gated individually, a few switch calls at a time.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { resolveCaller } from '../auth/caller.js';
import { gateCheck, getUserRoles, mayAccessSwitch } from '../rbac/store.js';
import { audit } from '../audit/store.js';
import { getSwitch } from '../inventory/store.js';
import { withSwitchToken } from '../nvue/clients.js';
import { GuardError } from '../nvue/guard.js';

const FieldList = z
  .union([z.string().min(1).max(256), z.array(z.string().min(1).max(256)).max(64)])
  .optional()
  .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]));

/** Member reads in flight per collect call: enough to be quick, never a storm (decision 11). */
const COLLECT_CONCURRENCY = 6;
const COLLECT_MAX_KEYS = 256;

const Collect = z.object({
  /** Collection whose keys drive the fan-out, e.g. `/interface`. */
  each: z.string().min(1),
  /** Member path with one `{key}` slot directly under `each`, e.g. `/interface/{key}/lldp/neighbor`. */
  path: z.string().min(1),
  rev: z.string().min(1).optional(),
  /** Revision for listing the keys when it differs (bridge domains list under `applied`). */
  eachRev: z.string().min(1).optional(),
});

/** Run `fn` over `items`, at most `n` at once, results in input order. */
async function mapLimit<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

const Query = z.object({
  path: z.string().min(1),
  rev: z.string().min(1).optional(),
  view: z.string().min(1).optional(),
  include: FieldList,
  omit: FieldList,
});

export async function queryRoutes(app: FastifyInstance, deps: { cfg: AuthConfig }): Promise<void> {
  const { cfg } = deps;

  /**
   * Session + switch + RBAC for a read of `paths` on switch `id`. Denials are
   * audited and answered here; on success the caller proceeds with `who`.
   */
  async function authorizeRead(
    request: FastifyRequest,
    reply: FastifyReply,
    id: string,
    paths: string[],
  ): Promise<{ sub: string } | null> {
    const who = await resolveCaller(request, cfg);
    if (!who) {
      await problem(reply, 401, 'Unauthorized', 'no active session', request.url);
      return null;
    }
    const sw = await getSwitch(id);
    if (!sw) {
      await problem(reply, 404, 'Not Found', `no switch ${id}`, request.url);
      return null;
    }
    const roles = await getUserRoles(who.sub);
    const deny = async (detail: string) => {
      await audit({
        userSub: who.sub,
        username: who.username,
        roles: roles.map((r) => r.id),
        switchId: id,
        method: 'GET',
        path: request.url,
      });
      await problem(reply, 403, 'Forbidden', detail, request.url);
      return null;
    };
    if (!mayAccessSwitch(roles, sw.groups)) return deny(`no role covers switch ${id}`);
    for (const path of paths) {
      if (!gateCheck(roles, { method: 'GET', path, switchGroups: sw.groups })) {
        return deny('not granted by any role');
      }
    }
    return { sub: who.sub };
  }

  app.get('/api/v1/switches/:id/query', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = Query.safeParse(request.query);
    if (!parsed.success) {
      if (!(await resolveCaller(request, cfg)))
        return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
      return problem(reply, 400, 'Bad Request', 'path query required', request.url);
    }
    const who = await authorizeRead(request, reply, id, [parsed.data.path]);
    if (!who) return reply;
    try {
      const res = await withSwitchToken(who.sub, id, { credKey: cfg.credKey }, (client, token) =>
        client.call({
          path: parsed.data.path,
          method: 'GET',
          rev: parsed.data.rev,
          view: parsed.data.view,
          include: parsed.data.include,
          omit: parsed.data.omit,
          token,
        }),
      );
      return { data: res.data };
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

  app.get('/api/v1/switches/:id/collect', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = Collect.safeParse(request.query);
    const each = parsed.success ? parsed.data.each.replace(/\/+$/, '') : '';
    if (
      !parsed.success ||
      !parsed.data.path.startsWith(`${each}/{key}`) ||
      parsed.data.path.split('{key}').length !== 2
    ) {
      if (!(await resolveCaller(request, cfg)))
        return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
      return problem(reply, 400, 'Bad Request', 'each + path with one {key} under it required', request.url);
    }
    const { path, rev, eachRev } = parsed.data;
    const who = await authorizeRead(request, reply, id, [each]);
    if (!who) return reply;
    const read = (p: string, r?: string) =>
      withSwitchToken(who.sub, id, { credKey: cfg.credKey }, (client, token) =>
        client.call({ path: p, method: 'GET', rev: r, token }),
      );
    try {
      const listing = await read(each, eachRev ?? rev);
      const keys = Object.keys((listing.data ?? {}) as Record<string, unknown>).slice(0, COLLECT_MAX_KEYS);
      const paths = keys.map((k) => path.replace('{key}', encodeURIComponent(k)));
      // Every member path is gated on its own: a role may cover /interface but not one subtree.
      const gated = await authorizeRead(request, reply, id, paths);
      if (!gated) return reply;
      const data: Record<string, unknown> = {};
      const errors: Record<string, string> = {};
      await mapLimit(keys, COLLECT_CONCURRENCY, async (key) => {
        try {
          data[key] = (await read(path.replace('{key}', encodeURIComponent(key)), rev)).data;
        } catch (err) {
          // 404 = nothing there for this member (no neighbors, BGP off): empty, not a failure.
          if ((err as { status?: number }).status === 404) data[key] = null;
          else errors[key] = (err as Error).message;
        }
      });
      return { data, errors };
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
