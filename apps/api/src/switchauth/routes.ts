/**
 * Switch-auth routes (roadmap 0.6). The UI POSTs the user's own switch password
 * once per switch; the backend mints a JWT via the switch's api-token endpoint
 * and holds it in server memory. The password is never stored, logged, or
 * returned — it lives only for the mint call below.
 * Identity comes from the session cookie; scope (which switches) from the
 * caller's stored roles via mayAccessSwitch. Full method/path gating is the
 * Phase 1 proxy's job.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { resolveCaller } from '../auth/caller.js';
import { getSwitch } from '../inventory/store.js';
import { getUserRoles, mayAccessSwitch } from '../rbac/store.js';
import { audit } from '../audit/store.js';
import { fetchJson, type JsonRequest } from '../nvue/tls.js';
import { dropSwitchToken, getSwitchToken, setSwitchToken } from './sessions.js';

export interface SwitchAuthDeps {
  cfg: AuthConfig;
  fetchJsonFn?: (req: JsonRequest) => Promise<unknown>;
}

const MintBody = z.object({ username: z.string().min(1).optional(), password: z.string().min(1) });

/** Mint a switch JWT with Basic auth. Pure orchestration — transport injectable for tests. */
export async function mintSwitchToken(
  baseUrl: string,
  basePath: string,
  username: string,
  password: string,
  pin: string,
  caPem: string,
  fetchFn: (req: JsonRequest) => Promise<unknown> = fetchJson,
): Promise<string> {
  const body = (await fetchFn({
    url: `${baseUrl}${basePath}/api-token`,
    username,
    password,
    pin,
    caPem,
  })) as { token?: unknown };
  if (typeof body?.token !== 'string' || body.token.length === 0) {
    throw new Error('switch did not issue a token (check username/password)');
  }
  return body.token;
}

export async function switchAuthRoutes(app: FastifyInstance, deps: SwitchAuthDeps): Promise<void> {
  const { cfg, fetchJsonFn } = deps;

  app.post('/api/v1/switch-auth/:id', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id } = request.params as { id: string };
    const parsed = MintBody.safeParse(request.body);
    if (!parsed.success) {
      return problem(reply, 400, 'Bad Request', 'username (optional) and password required', request.url);
    }
    const sw = await getSwitch(id);
    if (!sw) return problem(reply, 404, 'Not Found', `no switch ${id}`, request.url);
    if (!sw.enabled) return problem(reply, 409, 'Conflict', `switch ${id} is disabled`, request.url);
    if (!sw.cert_fingerprint || !sw.cert_pem) {
      return problem(
        reply,
        409,
        'Conflict',
        `switch ${id} predates certificate storage — re-enrol it`,
        request.url,
      );
    }
    const roles = await getUserRoles(who.sub);
    const roleIds = roles.map((r) => r.id);
    if (!mayAccessSwitch(roles, sw.groups)) {
      await audit({
        userSub: who.sub,
        username: who.username,
        roles: roleIds,
        switchId: id,
        method: 'POST',
        path: request.url,
      });
      return problem(reply, 403, 'Forbidden', `no role covers switch ${id}`, request.url);
    }
    try {
      const token = await mintSwitchToken(
        sw.base_url,
        sw.base_path,
        parsed.data.username ?? who.username,
        parsed.data.password,
        sw.cert_fingerprint,
        sw.cert_pem,
        fetchJsonFn,
      );
      setSwitchToken(who.sub, id, token);
      // password falls out of scope here — never stored, never logged.
      await audit({
        userSub: who.sub,
        username: who.username,
        roles: roleIds,
        switchId: id,
        method: 'POST',
        path: request.url,
      });
      return reply.code(204).send();
    } catch {
      return problem(reply, 401, 'Unauthorized', 'switch rejected the credentials', request.url);
    }
  });

  app.get('/api/v1/switch-auth/:id', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id } = request.params as { id: string };
    return { connected: getSwitchToken(who.sub, id) !== null };
  });

  app.delete('/api/v1/switch-auth/:id', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const { id } = request.params as { id: string };
    dropSwitchToken(who.sub, id);
    await audit({
      userSub: who.sub,
      username: who.username,
      roles: [],
      switchId: id,
      method: 'DELETE',
      path: request.url,
    });
    return reply.code(204).send();
  });
}
