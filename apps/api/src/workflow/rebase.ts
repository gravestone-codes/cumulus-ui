/**
 * Rebase (roadmap 4.5, decision 6.5): the loser of an apply race keeps their
 * draft. A fresh branch is cut from the current applied revision and the same
 * intents are re-staged through stageChange (gate, before-image, audit);
 * leaves that already landed drop out. The old draft is restored if anything
 * fails before the swap completes — never a silent drop.
 */
import { db } from '../db.js';
import { audit } from '../audit/store.js';
import { gateCheck, mayAccessSwitch } from '../rbac/store.js';
import { withSwitchToken } from '../nvue/clients.js';
import { createBranch } from '../nvue/revisions.js';
import { jsonEqual } from '../lib/json.js';
import type { Switch } from '../inventory/store.js';
import { getEditSession, type StagedPath } from './branches.js';
import { enqueueApply } from './apply.js';
import { stageChange, StageError, type StageCall, type StageContext } from './stage.js';

export interface RebaseResult {
  /** False when nothing was left to stage — everything already landed. */
  rebased: boolean;
  /** Set when every staged leaf already matches the switch. */
  alreadyApplied: boolean;
  branch: string | null;
  baseRev: string | null;
  /** Paths re-staged on the new branch. */
  staged: string[];
  /** Paths that dropped out entirely because they already landed. */
  dropped: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The part of a PATCH body that the switch does not already hold; null when
 * every leaf landed. An empty-object leaf (`{member: {swp1: {}}}`) means
 * "exists", so it landed once the key is present. Pure — unit-tested.
 */
export function pendingBody(body: Record<string, unknown>, current: unknown): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    const cur = isObj(current) ? current[k] : undefined;
    if (isObj(v) && Object.keys(v).length > 0) {
      const sub = pendingBody(v, cur);
      if (sub) out[k] = sub;
    } else if (isObj(v) ? cur === undefined || cur === null : !jsonEqual(cur, v)) {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** What still needs staging for one staged path, given the live value (undefined = absent). */
export function pendingCall(staged: StagedPath, current: unknown): StageCall | null {
  if (staged.method === 'DELETE') {
    return current === undefined ? null : { path: staged.path, method: 'DELETE' };
  }
  if (!isObj(staged.after)) {
    throw new StageError(409, `cannot rebase ${staged.path}: its staged body was not recorded — restage it`);
  }
  const body = pendingBody(staged.after, current);
  return body ? { path: staged.path, method: 'PATCH', body } : null;
}

/** Re-stage one user's draft on a fresh branch off applied. Serialized with applies on the switch. */
export async function rebaseSession(
  ctx: StageContext,
  sw: Switch & { groups: string[] },
): Promise<RebaseResult> {
  if (!mayAccessSwitch(ctx.roles, sw.groups)) throw new StageError(403, `no role covers switch ${sw.id}`);
  return enqueueApply(sw.id, async () => {
    const old = await getEditSession(ctx.sub, sw.id);
    if (!old || old.staged.length === 0) throw new StageError(409, 'nothing staged — nothing to rebase');
    for (const s of old.staged) {
      if (!gateCheck(ctx.roles, { method: s.method, path: s.path, switchGroups: sw.groups })) {
        throw new StageError(403, `not granted by any role: ${s.method} ${s.path}`);
      }
    }
    const run = { credKey: ctx.credKey };
    const calls: StageCall[] = [];
    const dropped: string[] = [];
    for (const s of old.staged) {
      const current = await withSwitchToken(ctx.sub, sw.id, run, (client, token) =>
        client.call({ path: s.path, method: 'GET', token }).then(
          (r) => r.data as unknown,
          (err: unknown) => {
            if ((err as { status?: number }).status === 404) return undefined;
            throw err;
          },
        ),
      );
      const call = pendingCall(s, current);
      if (call) calls.push(call);
      else dropped.push(s.path);
    }

    let next: { branch: string; baseRev: string | null } | null = null;
    if (calls.length > 0) {
      next = await withSwitchToken(ctx.sub, sw.id, run, (client, token) => createBranch(client, token));
      await db().query(
        `UPDATE edit_sessions SET branch = $3, base_rev = $4, staged_paths = '[]', updated_at = now()
         WHERE user_sub = $1 AND switch_id = $2`,
        [ctx.sub, sw.id, next.branch, next.baseRev],
      );
      try {
        for (const call of calls) await stageChange(ctx, sw, call);
      } catch (err) {
        // Put the old draft back exactly as it was; the half-built branch is best-effort cleanup.
        await db().query(
          `UPDATE edit_sessions SET branch = $3, base_rev = $4, staged_paths = $5::jsonb, updated_at = now()
           WHERE user_sub = $1 AND switch_id = $2`,
          [ctx.sub, sw.id, old.branch, old.baseRev, JSON.stringify(old.staged)],
        );
        await dropRevision(ctx, sw.id, next.branch);
        throw err;
      }
    } else {
      await db().query('DELETE FROM edit_sessions WHERE user_sub = $1 AND switch_id = $2', [ctx.sub, sw.id]);
    }
    await dropRevision(ctx, sw.id, old.branch);

    const result: RebaseResult = {
      rebased: next !== null,
      alreadyApplied: next === null,
      branch: next?.branch ?? null,
      baseRev: next?.baseRev ?? null,
      staged: calls.map((c) => c.path),
      dropped,
    };
    await audit({
      userSub: ctx.sub,
      username: ctx.username,
      roles: ctx.roles.map((r) => r.id),
      switchId: sw.id,
      method: 'POST',
      path: `/api/v1/switches/${sw.id}/rebase`,
      before: { branch: old.branch, baseRev: old.baseRev, paths: old.staged.map((s) => s.path) },
      after: result,
      rev: next?.branch,
    });
    return result;
  });
}

/** Best-effort switch-side delete of a revision (NVUE GC catches what this misses). */
async function dropRevision(ctx: StageContext, switchId: string, branch: string): Promise<void> {
  await withSwitchToken(ctx.sub, switchId, { credKey: ctx.credKey }, (client, token) =>
    client.call({ path: `/revision/${encodeURIComponent(branch)}`, method: 'DELETE', token }),
  ).catch(() => undefined);
}
