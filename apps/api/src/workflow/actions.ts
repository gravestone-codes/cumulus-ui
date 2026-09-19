/**
 * ActionRunner (roadmap 1.4/R6): generic driver for the 169 POST actions
 * (clear counters/BGP/MAC, LED, tech-support, ...). RBAC decides WHO
 * (gateCheck, incl. the dangerous class); the manifest gate decides WHAT
 * exists; this decides HOW (run → track job → audit). No per-action code.
 */
import { clientFor, tokenFor } from '../nvue/clients.js';
import { extractJobId } from '../nvue/revisions.js';
import { DANGEROUS_PREFIXES } from '../rbac/store.js';
import { audit } from '../audit/store.js';
import { pollJob } from './apply.js';

export interface ActionContext {
  sub: string;
  username: string;
  roleIds: string[];
}

export interface ActionResult {
  status: number;
  data: unknown;
  jobId: string | null;
  finalState: string | null;
  /** True when the UI must demand typed confirmation (roadmap §6.6). */
  dangerous: boolean;
}

/** Whether a path falls in the §6.6 dangerous class. */
export function isDangerous(path: string): boolean {
  return DANGEROUS_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Run one POST action end-to-end. Throws GuardError/NvueError like any call. */
export async function runAction(
  ctx: ActionContext,
  switchId: string,
  path: string,
  body: Record<string, unknown> | undefined,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<ActionResult> {
  const { client } = await clientFor(ctx.sub, switchId);
  const token = tokenFor(ctx.sub, switchId);
  const { status, data } = await client.call({ path, method: 'POST', body, token });
  const jobId = extractJobId(data);
  let finalState: string | null = null;
  if (jobId) {
    try {
      finalState = await pollJob(ctx.sub, switchId, jobId, {
        intervalMs: opts.intervalMs ?? 1000,
        timeoutMs: opts.timeoutMs ?? 120_000,
      });
    } catch {
      finalState = null; // job tracking is best-effort; the action itself ran
    }
  }
  const result = { status, data, jobId, finalState, dangerous: isDangerous(path) };
  await audit({
    userSub: ctx.sub,
    username: ctx.username,
    roles: ctx.roleIds,
    switchId,
    method: 'POST',
    path,
    after: body ?? null,
    jobId: jobId ?? undefined,
  });
  return result;
}
