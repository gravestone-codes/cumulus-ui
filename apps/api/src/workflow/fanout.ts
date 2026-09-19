/**
 * FanOut (roadmap 1.6/R22): mirrored writes across a group. Each switch gets
 * its own branch and its own result — a sibling's failure never rolls back
 * applied siblings (reported, not hidden). Built from stageChange/applySession,
 * never reimplementing them.
 */
import { getSwitchesByGroup } from '../inventory/store.js';
import { gateCheck } from '../rbac/store.js';
import { getEditSession, openBranch, BranchConflictError } from './branches.js';
import { stageChange, type StageContext } from './stage.js';
import { applySession } from './apply.js';

export interface FanoutResult {
  switchId: string;
  ok: boolean;
  branch?: string;
  jobId?: string | null;
  paths?: string[];
  error?: string;
}

/** Stage the same change on every switch in the group. One branch each. */
export async function fanoutStage(
  ctx: StageContext,
  groupId: string,
  call: { path: string; method: 'PATCH' | 'DELETE'; body?: Record<string, unknown> },
): Promise<FanoutResult[]> {
  const switches = await getSwitchesByGroup(groupId);
  const results: FanoutResult[] = [];
  for (const sw of switches) {
    try {
      const existing = await getEditSession(ctx.sub, sw.id);
      if (!existing) await openBranch(ctx.sub, sw.id);
      const { branch } = await stageChange(ctx, sw, call);
      results.push({ switchId: sw.id, ok: true, branch });
    } catch (err) {
      results.push({
        switchId: sw.id,
        ok: false,
        error: err instanceof BranchConflictError ? err.message : (err as Error).message,
      });
    }
  }
  return results;
}

/** Apply every staged switch in the group. Partial failure is reported per switch. */
export async function fanoutApply(ctx: StageContext, groupId: string): Promise<FanoutResult[]> {
  const roleIds = ctx.roles.map((r) => r.id);
  const switches = await getSwitchesByGroup(groupId);
  const results: FanoutResult[] = [];
  for (const sw of switches) {
    try {
      // Same apply right as single-switch (matrix: operators stage, only admins apply).
      if (!gateCheck(ctx.roles, { method: 'POST', path: '/config', switchGroups: sw.groups })) {
        results.push({ switchId: sw.id, ok: false, error: 'apply not granted — POST /config required' });
        continue;
      }
      const applied = await applySession({ sub: ctx.sub, username: ctx.username, roleIds }, sw.id);
      results.push({ switchId: sw.id, ok: true, jobId: applied.jobId, paths: applied.paths });
    } catch (err) {
      results.push({ switchId: sw.id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}
