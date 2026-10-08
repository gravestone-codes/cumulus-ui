/**
 * ApplyPipeline (roadmap 1.3/R5): serialize per switch, OCC-check every staged
 * path against live operational state, apply, poll the job, clear the session.
 * First to apply wins; the second gets a 409 with mine/theirs/current diffs —
 * D365-style OCC with path-level granularity (finer than whole-record).
 */
import { db } from '../db.js';
import { withSwitchToken } from '../nvue/clients.js';
import {
  applyBranch as applyRevision,
  getAction,
  getAppliedRevision,
  getRevisionState,
} from '../nvue/revisions.js';
import { jsonEqual } from '../lib/json.js';
import { audit } from '../audit/store.js';
import { getEditSession, type StagedPath } from './branches.js';
import { driftSinceDraft, observeRevision, type Drift } from './drift.js';
import type { NvueClient } from '../nvue/client.js';

/** Read live values and classify every staged path. Shared by dry-run and apply. */
export async function collectDiffs(
  client: NvueClient,
  token: string,
  staged: StagedPath[],
): Promise<PathDiff[]> {
  const diffs: PathDiff[] = [];
  for (const s of staged) {
    const mine = s.after ?? null;
    const current = await occImage(client, token, s.path, s.method, mine);
    diffs.push({
      path: s.path,
      method: s.method,
      before: s.before,
      mine,
      current,
      state: diffState(s.before, mine, current),
      // Attribution is resolved only on apply conflicts (findLandedBy); dry-run rows carry none.
      landedBy: null,
    });
  }
  return diffs;
}

export interface LandedBy {
  userSub: string;
  username: string;
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
  /** Who applied the landed value, when known from our audit (null = outside the app). */
  landedBy: LandedBy | null;
}

export type DiffState = 'clean' | 'applied' | 'conflict';

export interface PathDiff extends Conflict {
  state: DiffState;
}

/**
 * The part of `data` a PATCH body touches, shaped like the body. OCC compares
 * only these leaves, so counters ticking elsewhere on the object never conflict.
 */
export function lens(data: unknown, shape: unknown): unknown {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObj(shape) || Object.keys(shape).length === 0) return data ?? null;
  return Object.fromEntries(
    Object.entries(shape).map(([k, v]) => [k, lens(isObj(data) ? data[k] : undefined, v)]),
  );
}

/**
 * The OCC image of one staged path: a PATCH compares the operational leaves
 * its body touches; a DELETE compares the applied config of the whole object
 * (operational counters tick constantly and would always "conflict"). Null
 * when the path is absent.
 */
export async function occImage(
  client: NvueClient,
  token: string,
  path: string,
  method: string,
  body: unknown,
): Promise<unknown> {
  const patch = method === 'PATCH' && body !== null && body !== undefined;
  return client
    .call({ path, method: 'GET', token, ...(patch ? {} : { rev: 'applied' }) })
    .then((r) => (patch ? lens(r.data, body) : r.data))
    .catch(() => null);
}

/** Classify one staged path against live state. Pure — unit-tested. */
export function diffState(before: unknown, mine: unknown, current: unknown): DiffState {
  if (jsonEqual(current, before)) return 'clean';
  if (mine !== undefined && jsonEqual(current, mine)) return 'applied';
  return 'conflict';
}

/**
 * Thrown when someone changed a staged path out from under us, or the switch
 * moved outside the app after the draft was cut (`outOfBand`). → 409 + diffs.
 */
export class OverlapError extends Error {
  readonly conflicts: Conflict[];
  readonly outOfBand: Drift | null;
  constructor(conflicts: Conflict[], outOfBand: Drift | null = null) {
    super(
      outOfBand
        ? `${outOfBand.switchId} changed outside the app since you staged — review and rebase`
        : `${conflicts.length} staged path(s) changed on the switch since staging`,
    );
    this.conflicts = conflicts;
    this.outOfBand = outOfBand;
  }
}

/**
 * Who last applied `path` on `switchId`, from our audit (apply rows carry the
 * covered paths in `after.paths`). Null when nothing in the trail covers it —
 * the change landed outside the app (CLI / direct API).
 */
export async function findLandedBy(switchId: string, path: string): Promise<LandedBy | null> {
  const { rows } = await db().query<{ user_sub: string; username: string }>(
    `SELECT user_sub, username FROM audit_log
      WHERE switch_id = $1 AND method = 'POST' AND path LIKE '%/apply' AND after->'paths' ? $2
      ORDER BY id DESC LIMIT 1`,
    [switchId, path],
  );
  const row = rows[0];
  return row ? { userSub: row.user_sub, username: row.username } : null;
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

/** True while an apply/rebase (or revision check) holds the switch's queue. */
export function applyBusy(switchId: string): boolean {
  return queues.has(switchId);
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
  opts: { intervalMs?: number; timeoutMs?: number; credKey?: string } = {},
): Promise<string> {
  const interval = opts.intervalMs ?? 2000;
  const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
  for (;;) {
    const job = await withSwitchToken(userSub, switchId, { credKey: opts.credKey }, (client, token) =>
      getAction(client, token, jobId),
    );
    const state = job.state.toLowerCase();
    if (SUCCESS.has(state)) return job.state;
    if (FAILURE.has(state)) throw new Error(`apply job ${jobId} failed: ${job.state}`);
    if (Date.now() > deadline)
      throw new Error(`apply job ${jobId} did not finish in time (last state: ${job.state})`);
    await sleep(interval);
  }
}

/** NVUE answers apply with no job id; follow the revision's own state instead. */
export async function pollRevision(
  userSub: string,
  switchId: string,
  branch: string,
  opts: { intervalMs?: number; timeoutMs?: number; credKey?: string } = {},
): Promise<string> {
  const interval = opts.intervalMs ?? 2000;
  const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
  for (;;) {
    const state = await withSwitchToken(userSub, switchId, { credKey: opts.credKey }, (client, token) =>
      getRevisionState(client, token, branch),
    );
    if (state === 'applied' || state === 'applied_and_saved') return state;
    if (state.includes('fail') || state === 'invalid' || state === 'ays_no') {
      throw new Error(`apply of revision ${branch} failed: ${state}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`apply of revision ${branch} did not finish in time (last state: ${state})`);
    }
    await sleep(interval);
  }
}

export interface ApplyContext {
  sub: string;
  username: string;
  roleIds: string[];
  credKey: string;
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
    const run = { credKey: ctx.credKey };
    // Catch a move the poller has not seen yet; a switch that cannot say leaves it to the poller.
    await withSwitchToken(ctx.sub, switchId, run, (client, token) => getAppliedRevision(client, token))
      .then((rev) => observeRevision(switchId, rev))
      .catch(() => null);
    const outOfBand = await driftSinceDraft(ctx.sub, switchId);
    const diffs = await withSwitchToken(ctx.sub, switchId, run, (client, token) =>
      collectDiffs(client, token, session.staged),
    );
    // A draft cut before an out-of-band move is reviewed whole, never applied blind.
    const raw = diffs
      .filter((d) => outOfBand !== null || d.state === 'conflict')
      .map(({ path, method, before, mine, current }) => ({ path, method, before, mine, current }));
    if (raw.length > 0) {
      const conflicts: Conflict[] = await Promise.all(
        raw.map(async (c) => ({ ...c, landedBy: await findLandedBy(switchId, c.path) })),
      );
      // The attempt itself is material: who tried, against what (R2e).
      await audit({
        userSub: ctx.sub,
        username: ctx.username,
        roles: ctx.roleIds,
        switchId,
        method: 'POST',
        path: `/api/v1/switches/${switchId}/apply`,
        before: session.staged,
        after: { conflicts, ...(outOfBand ? { outOfBand } : {}) },
        rev: session.branch,
      });
      throw new OverlapError(conflicts, outOfBand);
    }

    const { jobId } = await withSwitchToken(ctx.sub, switchId, run, (client, token) =>
      applyRevision(client, token, session.branch),
    );
    if (jobId) await pollJob(ctx.sub, switchId, jobId, opts);
    else await pollRevision(ctx.sub, switchId, session.branch, { ...opts, credKey: ctx.credKey });
    // Our own move: the new applied ID becomes the baseline, never drift.
    await withSwitchToken(ctx.sub, switchId, run, (client, token) => getAppliedRevision(client, token))
      .then((rev) => observeRevision(switchId, rev, { ours: true }))
      .catch(() => null);
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
