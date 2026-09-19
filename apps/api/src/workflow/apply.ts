/**
 * ApplyPipeline (roadmap 1.3/R5): serialize per switch, OCC-check every staged
 * path against live operational state, apply, poll the job, clear the session.
 * First to apply wins; the second gets a 409 with mine/theirs/current diffs —
 * D365-style OCC with path-level granularity (finer than whole-record).
 */
import { db } from '../db.js';
import { clientFor, tokenFor } from '../nvue/clients.js';
import { applyBranch as applyRevision, getAction } from '../nvue/revisions.js';
import { jsonEqual } from '../lib/json.js';
import { audit } from '../audit/store.js';
import { getEditSession, type StagedPath } from './branches.js';
import type { NvueClient } from '../nvue/client.js';

/** Read live values and classify every staged path. Shared by dry-run and apply. */
export async function collectDiffs(
  client: NvueClient,
  token: string,
  staged: StagedPath[],
): Promise<PathDiff[]> {
  const diffs: PathDiff[] = [];
  for (const s of staged) {
    const current = await client
      .call({ path: s.path, method: 'GET', token })
      .then((r) => r.data)
      .catch(() => null);
    const mine = s.after ?? null;
    diffs.push({
      path: s.path,
      method: s.method,
      before: s.before,
      mine,
      current,
      state: diffState(s.before, mine, current),
    });
  }
  return diffs;
}

export interface Conflict {
  path: string;
  method: string;
  /** Snapshot at stage time. */
  before: unknown;
  /** Our staged intent (PATCH body, or null for DELETE). */
  mine: unknown;
  /** Live operational value right now. */
  current: unknown;
}

export type DiffState = 'clean' | 'applied' | 'conflict';

export interface PathDiff extends Conflict {
  state: DiffState;
}

/** Classify one staged path against live state. Pure — unit-tested. */
export function diffState(before: unknown, mine: unknown, current: unknown): DiffState {
  if (jsonEqual(current, before)) return 'clean';
  if (mine !== undefined && jsonEqual(current, mine)) return 'applied';
  return 'conflict';
}

/** Thrown when someone changed a staged path out from under us. → 409 + diffs. */
export class OverlapError extends Error {
  readonly conflicts: Conflict[];
  constructor(conflicts: Conflict[]) {
    super(`${conflicts.length} staged path(s) changed on the switch since staging`);
    this.conflicts = conflicts;
  }
}

export interface ApplyResult {
  applied: boolean;
  jobId: string | null;
  paths: string[];
}

const queues = new Map<string, Promise<unknown>>();

/**
 * Serialize applies per switch — the single pessimistic moment (seconds, never
 * think-time). In-memory: correct on one instance; HA needs a distributed
 * lock (recorded, not built — single backend until then).
 */
export function enqueueApply<T>(switchId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(switchId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  queues.set(switchId, next);
  void next
    .catch(() => undefined)
    .finally(() => {
      if (queues.get(switchId) === next) queues.delete(switchId);
    });
  return next;
}

const SUCCESS = new Set([
  'success',
  'successful',
  'done',
  'applied',
  'action_success',
  'complete',
  'completed',
]);
const FAILURE = new Set(['fail', 'failed', 'error', 'action_error']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll an action job to a terminal state. Terminal vocab validated at M1. */
export async function pollJob(
  userSub: string,
  switchId: string,
  jobId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<string> {
  const { client } = await clientFor(userSub, switchId);
  const token = tokenFor(userSub, switchId);
  const interval = opts.intervalMs ?? 2000;
  const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
  for (;;) {
    const job = await getAction(client, token, jobId);
    const state = job.state.toLowerCase();
    if (SUCCESS.has(state)) return job.state;
    if (FAILURE.has(state)) throw new Error(`apply job ${jobId} failed: ${job.state}`);
    if (Date.now() > deadline)
      throw new Error(`apply job ${jobId} did not finish in time (last state: ${job.state})`);
    await sleep(interval);
  }
}

export interface ApplyContext {
  sub: string;
  username: string;
  roleIds: string[];
}

/** Full apply for one user's session. Throws OverlapError / NvueError / timeouts. */
export async function applySession(
  ctx: ApplyContext,
  switchId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<ApplyResult> {
  return enqueueApply(switchId, async () => {
    const session = await getEditSession(ctx.sub, switchId);
    if (!session || session.staged.length === 0) {
      throw Object.assign(new Error('nothing staged — stage changes first'), { status: 409 });
    }
    const { client } = await clientFor(ctx.sub, switchId);
    const token = tokenFor(ctx.sub, switchId);

    const diffs = await collectDiffs(client, token, session.staged);
    const conflicts: Conflict[] = diffs
      .filter((d) => d.state === 'conflict')
      .map(({ path, method, before, mine, current }) => ({ path, method, before, mine, current }));
    if (conflicts.length > 0) throw new OverlapError(conflicts);

    const { jobId } = await applyRevision(client, token, session.branch);
    if (jobId) await pollJob(ctx.sub, switchId, jobId, opts);
    await db().query('DELETE FROM edit_sessions WHERE user_sub = $1 AND switch_id = $2', [ctx.sub, switchId]);
    const result = { applied: true, jobId, paths: session.staged.map((s) => s.path) };
    await audit({
      userSub: ctx.sub,
      username: ctx.username,
      roles: ctx.roleIds,
      switchId,
      method: 'POST',
      path: `/api/v1/switches/${switchId}/apply`,
      after: result,
      rev: session.branch,
      jobId: jobId ?? undefined,
    });
    return result;
  });
}
