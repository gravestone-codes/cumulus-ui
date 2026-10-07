/**
 * FanOut (roadmap 1.6/R22): mirrored writes, actions and reads across a group.
 * Each switch gets its own branch and its own result — a sibling's failure
 * never rolls back applied siblings (reported, not hidden). Built from
 * stageChange/applySession/runAction, never reimplementing them.
 */
import { getSwitchesByGroup, type SwitchWithState } from '../inventory/store.js';
import { gateCheck, mayAccessSwitch, type Role } from '../rbac/store.js';
import { withSwitchToken } from '../nvue/clients.js';
import { getEditSession, openBranch, BranchConflictError } from './branches.js';
import { stageChange, type StageContext } from './stage.js';
import { applySession } from './apply.js';
import { runAction } from './actions.js';

export interface FanoutResult {
  switchId: string;
  ok: boolean;
  branch?: string;
  jobId?: string | null;
  paths?: string[];
  error?: string;
  /** Unapplied changes already staged there (exclusive stage only) — discard first. */
  conflict?: boolean;
}

export interface FanoutTargets {
  /** Subset of the group to touch; omitted = every member. Non-members are reported, not touched. */
  members?: string[];
}

/** Group members narrowed to `members`, plus error rows for ids outside the group. */
async function targets(
  groupId: string,
  members?: string[],
): Promise<{ switches: SwitchWithState[]; strays: FanoutResult[] }> {
  const all = await getSwitchesByGroup(groupId);
  if (!members) return { switches: all, strays: [] };
  const ids = new Set(all.map((s) => s.id));
  return {
    switches: all.filter((s) => members.includes(s.id)),
    strays: members
      .filter((m) => !ids.has(m))
      .map((m) => ({ switchId: m, ok: false, error: `${m} is not in group ${groupId}` })),
  };
}

/**
 * Stage on every targeted switch, one branch each. `bodies` carries
 * per-switch bodies (per-switch-unique values); `body` is the shared one.
 * `exclusive` refuses switches holding unrelated staged changes instead of
 * piling onto them, so a review shows only this change.
 */
export async function fanoutStage(
  ctx: StageContext,
  groupId: string,
  call: {
    path: string;
    method: 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
    bodies?: Record<string, Record<string, unknown>>;
  },
  opts: FanoutTargets & { exclusive?: boolean } = {},
): Promise<FanoutResult[]> {
  const members = opts.members ?? (call.bodies ? Object.keys(call.bodies) : undefined);
  const { switches, strays } = await targets(groupId, members);
  const results: FanoutResult[] = [...strays];
  for (const sw of switches) {
    try {
      const existing = await getEditSession(ctx.sub, sw.id);
      if (opts.exclusive && existing && existing.staged.length > 0) {
        throw new BranchConflictError(existing.branch);
      }
      if (!existing) await openBranch(ctx.sub, sw.id, { credKey: ctx.credKey });
      const body = call.bodies?.[sw.id] ?? call.body;
      const { branch } = await stageChange(ctx, sw, { path: call.path, method: call.method, body });
      results.push({ switchId: sw.id, ok: true, branch });
    } catch (err) {
      results.push({
        switchId: sw.id,
        ok: false,
        error: (err as Error).message,
        ...(err instanceof BranchConflictError ? { conflict: true } : {}),
      });
    }
  }
  return results;
}

/** Apply every targeted switch's staged session. Partial failure is reported per switch. */
export async function fanoutApply(
  ctx: StageContext,
  groupId: string,
  opts: FanoutTargets = {},
): Promise<FanoutResult[]> {
  const roleIds = ctx.roles.map((r) => r.id);
  const { switches, strays } = await targets(groupId, opts.members);
  const results: FanoutResult[] = [...strays];
  for (const sw of switches) {
    try {
      // Same apply right as single-switch (matrix: operators stage, only admins apply).
      if (!gateCheck(ctx.roles, { method: 'POST', path: '/config', switchGroups: sw.groups })) {
        results.push({ switchId: sw.id, ok: false, error: 'apply not granted — POST /config required' });
        continue;
      }
      const applied = await applySession(
        { sub: ctx.sub, username: ctx.username, roleIds, credKey: ctx.credKey },
        sw.id,
      );
      results.push({ switchId: sw.id, ok: true, jobId: applied.jobId, paths: applied.paths });
    } catch (err) {
      results.push({ switchId: sw.id, ok: false, error: (err as Error).message });
    }
  }
  return results;
}

export interface FanoutActionResult extends FanoutResult {
  finalState?: string | null;
}

/** Run one POST action on every targeted switch (ActionRunner per member, gated per member). */
export async function fanoutAction(
  ctx: StageContext,
  groupId: string,
  call: { path: string; body?: Record<string, unknown> },
  opts: FanoutTargets = {},
): Promise<FanoutActionResult[]> {
  const roleIds = ctx.roles.map((r) => r.id);
  const { switches, strays } = await targets(groupId, opts.members);
  return [
    ...strays,
    ...(await Promise.all(
      switches.map(async (sw): Promise<FanoutActionResult> => {
        if (!mayAccessSwitch(ctx.roles, sw.groups)) {
          return { switchId: sw.id, ok: false, error: `no role covers switch ${sw.id}` };
        }
        if (!gateCheck(ctx.roles, { method: 'POST', path: call.path, switchGroups: sw.groups })) {
          return { switchId: sw.id, ok: false, error: 'not granted by any role' };
        }
        try {
          const res = await runAction(
            { sub: ctx.sub, username: ctx.username, roleIds, credKey: ctx.credKey },
            sw.id,
            call.path,
            call.body,
          );
          return { switchId: sw.id, ok: true, jobId: res.jobId, finalState: res.finalState };
        } catch (err) {
          return { switchId: sw.id, ok: false, error: (err as Error).message };
        }
      }),
    )),
  ];
}

export interface FanoutReadResult {
  switchId: string;
  ok: boolean;
  data?: unknown;
  status?: number;
  error?: string;
}

/**
 * Read one path from every member in parallel (group screens). Each member
 * is gated on its own groups; a denied or failed member is a result row,
 * never a failure of the whole read. `denied` lists members for the audit.
 */
export async function fanoutQuery(
  ctx: { sub: string; roles: Role[]; credKey: string },
  groupId: string,
  call: { path: string; rev?: string; view?: string },
): Promise<{ results: FanoutReadResult[]; denied: string[] }> {
  const switches = await getSwitchesByGroup(groupId);
  const denied: string[] = [];
  const results = await Promise.all(
    switches.map(async (sw): Promise<FanoutReadResult> => {
      if (
        !mayAccessSwitch(ctx.roles, sw.groups) ||
        !gateCheck(ctx.roles, { method: 'GET', path: call.path, switchGroups: sw.groups })
      ) {
        denied.push(sw.id);
        return { switchId: sw.id, ok: false, status: 403, error: 'not granted by any role' };
      }
      try {
        const res = await withSwitchToken(ctx.sub, sw.id, { credKey: ctx.credKey }, (client, token) =>
          client.call({ path: call.path, method: 'GET', rev: call.rev, view: call.view, token }),
        );
        return { switchId: sw.id, ok: true, data: res.data };
      } catch (err) {
        const status = (err as { status?: number }).status;
        return {
          switchId: sw.id,
          ok: false,
          ...(typeof status === 'number' ? { status } : {}),
          error: (err as Error).message,
        };
      }
    }),
  );
  return { results, denied };
}
