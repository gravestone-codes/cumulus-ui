/**
 * Single-switch staging core (roadmap 1.1/1.6): gate on the STAGED method/path
 * (proxy-equivalent), snapshot the operational before-image, PATCH the user's
 * branch, record, audit. Used by the single-switch route and FanOut alike.
 */
import { gateCheck, mayAccessSwitch, type Role } from '../rbac/store.js';
import { audit } from '../audit/store.js';
import { clientFor, tokenFor } from '../nvue/clients.js';
import { addStagedPath, getEditSession } from './branches.js';
import type { Switch } from '../inventory/store.js';

export interface StageContext {
  sub: string;
  username: string;
  roles: Role[];
}

export interface StageCall {
  path: string;
  method: 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
}

/** Carries an HTTP status for route mapping. */
export class StageError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Stage one change. Throws StageError (gate/session) or propagates switch failures. */
export async function stageChange(
  ctx: StageContext,
  sw: Switch & { groups: string[] },
  call: StageCall,
): Promise<{ branch: string }> {
  if (!mayAccessSwitch(ctx.roles, sw.groups)) {
    throw new StageError(403, `no role covers switch ${sw.id}`);
  }
  if (!gateCheck(ctx.roles, { method: call.method, path: call.path, switchGroups: sw.groups })) {
    throw new StageError(403, 'not granted by any role');
  }
  const session = await getEditSession(ctx.sub, sw.id);
  if (!session) throw new StageError(409, 'no open branch — open one first');
  const { client } = await clientFor(ctx.sub, sw.id);
  const token = tokenFor(ctx.sub, sw.id);
  const before = await client
    .call({ path: call.path, method: 'GET', token })
    .then((r) => r.data)
    .catch(() => null);
  await client.call({ path: call.path, method: call.method, rev: session.branch, body: call.body, token });
  await addStagedPath(ctx.sub, sw.id, {
    path: call.path,
    method: call.method,
    before,
    after: call.body ?? null,
  });
  const roleIds = ctx.roles.map((r) => r.id);
  await audit({
    userSub: ctx.sub,
    username: ctx.username,
    roles: roleIds,
    switchId: sw.id,
    method: call.method,
    path: call.path,
    before,
    after: call.body ?? null,
    rev: session.branch,
  });
  return { branch: session.branch };
}
