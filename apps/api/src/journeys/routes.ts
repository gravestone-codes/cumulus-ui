/**
 * Journey endpoints (journey-roadmap.md). The catalog is served, never
 * shipped in the UI; runs are personal (`/me`). Writes never happen here:
 * change steps hand the UI a plan that rides stage → dry-run → apply like any
 * edit (per-user branch, no locks). What happens here is the gate: a check is
 * a server-side read with the caller's own switch token, through the same
 * PermissionGate as every read, so a step completes on evidence, not a click.
 * Finished and abandoned runs write one audit entry linking every step.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { resolveCaller, type Caller } from '../auth/caller.js';
import { gateCheck, getUserRoles, mayAccessSwitch, type Role } from '../rbac/store.js';
import { audit } from '../audit/store.js';
import { getSwitch, getSwitchesByGroup, type SwitchWithState } from '../inventory/store.js';
import { readMembers } from '../workflow/fanout.js';
import { JOURNEYS, journeyOf, type Journey } from './catalog.js';
import {
  captureFrom,
  evaluate,
  gatedCalls,
  moveOn,
  planCalls,
  RefError,
  recordCheck,
  startRun,
  validateInputs,
  verifyReads,
  type Evidence,
  type PlannedCall,
  type RunState,
} from './engine.js';
import {
  createRun,
  findActive,
  getRun,
  linkAudit,
  listRuns,
  saveRun,
  StaleRunError,
  type RunRow,
  type Scope,
} from './store.js';

const ScopeQuery = z.object({ kind: z.enum(['switch', 'group']), id: z.string().min(1).max(128) });
const StartBody = z.object({ journey: z.string().min(1).max(64), scope: ScopeQuery });
const StepBody = z.object({
  op: z.enum(['submit', 'verify', 'skip']),
  values: z.record(z.string(), z.union([z.string().max(512), z.number()])).optional(),
});

/** What the UI renders for a run: state plus the current change step's concrete plan. */
export interface RunView {
  id: string;
  journey: string;
  label: string;
  scope: Scope;
  members: string[];
  state: RunState['state'];
  current: string | null;
  steps: RunState['steps'];
  values: RunState['values'];
  note: string | null;
  auditId: number | null;
  createdAt: string;
  updatedAt: string;
  /** Writes of the current change step, ready for ChangeFlow; `planError` when a value is missing. */
  plan?: PlannedCall[];
  planError?: string;
}

function viewOf(row: RunRow): RunView {
  const journey = journeyOf(row.journey);
  const step = journey?.steps.find((s) => s.id === row.run.current);
  let plan: PlannedCall[] | undefined;
  let planError: string | undefined;
  if (step?.kind === 'change') {
    try {
      plan = planCalls(step.calls, row.run.values);
    } catch (err) {
      if (!(err instanceof RefError)) throw err;
      planError = err.message;
    }
  }
  return {
    id: row.id,
    journey: row.journey,
    label: journey?.label ?? row.journey,
    scope: row.scope,
    members: row.members,
    state: row.run.state,
    current: row.run.current,
    steps: row.run.steps,
    values: row.run.values,
    note: row.run.note,
    auditId: row.auditId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(plan ? { plan } : {}),
    ...(planError ? { planError } : {}),
  };
}

/** Switches behind a scope (a group's members), or null when there are none. */
async function scopeSwitches(scope: Scope): Promise<SwitchWithState[] | null> {
  if (scope.kind === 'switch') {
    const sw = await getSwitch(scope.id);
    return sw ? [sw] : null;
  }
  const members = await getSwitchesByGroup(scope.id);
  return members.length > 0 ? members : null;
}

/**
 * Why the caller cannot finish this journey here, or null. Cosmetic (UI shows
 * the journey locked up front); stage, apply and every check are gated again.
 */
export function lockReason(journey: Journey, roles: Role[], switches: SwitchWithState[]): string | null {
  const outside = switches.find((sw) => !mayAccessSwitch(roles, sw.groups));
  if (outside) return `No role of yours covers ${outside.id}.`;
  for (const call of gatedCalls(journey)) {
    for (const sw of switches) {
      if (!gateCheck(roles, { method: call.method, path: call.path, switchGroups: sw.groups })) {
        return `${call.step}: ${call.method} ${call.path.replace(/\/_(?=\/|$)/g, '/…')} is not granted by your roles.`;
      }
    }
  }
  return null;
}

/** One audit entry for a finished or abandoned run: who, roles, scope, every step and its evidence. */
async function auditRun(who: Caller, roles: Role[], row: RunRow): Promise<number> {
  const journey = journeyOf(row.journey);
  return audit({
    userSub: who.sub,
    username: who.username,
    roles: roles.map((r) => r.id),
    ...(row.scope.kind === 'switch' ? { switchId: row.scope.id } : {}),
    method: 'JOURNEY',
    path: `/journeys/${row.journey}`,
    after: {
      run: row.id,
      journey: row.journey,
      scope: row.scope,
      members: row.members,
      state: row.run.state,
      note: row.run.note,
      values: row.run.values,
      steps: (journey?.steps ?? [])
        .filter((s) => row.run.steps[s.id])
        .map((s) => {
          const st = row.run.steps[s.id];
          return {
            id: s.id,
            title: s.title,
            status: st?.status,
            at: st?.at,
            evidence: st?.evidence?.map((e) => ({
              switch: e.switchId,
              path: e.path,
              ok: e.ok,
              ...(e.error ? { error: e.error } : {}),
              failed: e.lines.filter((l) => !l.ok).map((l) => l.text),
            })),
          };
        }),
    },
  });
}

export async function journeyRoutes(app: FastifyInstance, deps: { cfg: AuthConfig }): Promise<void> {
  const { cfg } = deps;

  async function caller(request: FastifyRequest, reply: FastifyReply): Promise<Caller | null> {
    const who = await resolveCaller(request, cfg);
    if (!who) await problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    return who;
  }

  /** Persist, then (on a terminal state) audit and link. Stale saves answer 409. */
  async function persist(
    request: FastifyRequest,
    reply: FastifyReply,
    who: Caller,
    row: RunRow,
    next: RunState,
  ): Promise<RunView | null> {
    let saved: RunRow;
    try {
      saved = await saveRun(row, who.sub, next);
    } catch (err) {
      if (err instanceof StaleRunError) {
        await problem(reply, 409, 'Conflict', err.message, request.url);
        return null;
      }
      throw err;
    }
    const finished = saved.run.state === 'done' || saved.run.state === 'abandoned';
    if (finished && row.run.state !== saved.run.state) {
      const roles = await getUserRoles(who.sub);
      saved = await linkAudit(saved, await auditRun(who, roles, saved));
      request.log.info(
        { user: who.sub, action: 'journey', journey: saved.journey, run: saved.id, outcome: saved.run.state },
        'journey finished',
      );
    }
    return viewOf(saved);
  }

  /** Run the current step's gate reads on every member and grade them. */
  async function check(who: Caller, row: RunRow, journey: Journey, stepId: string) {
    const step = journey.steps.find((s) => s.id === stepId);
    if (!step || step.kind === 'input') throw new Error(`step ${stepId} has no check`);
    const roles = await getUserRoles(who.sub);
    const switches = (await Promise.all(row.members.map((m) => getSwitch(m)))).filter(
      (s): s is SwitchWithState => s !== null,
    );
    const evidence: Evidence[] = row.members
      .filter((m) => !switches.some((s) => s.id === m))
      .map((m) => ({
        switchId: m,
        path: '',
        ok: false,
        lines: [],
        error: `${m} is no longer in the inventory`,
      }));
    const captured: Record<string, string> = {};
    for (const read of verifyReads(step.verify, row.run.values)) {
      const { results, denied } = await readMembers({ sub: who.sub, roles, credKey: cfg.credKey }, switches, {
        path: read.path,
        ...(step.verify.rev ? { rev: step.verify.rev } : {}),
      });
      for (const sw of denied) {
        await audit({
          userSub: who.sub,
          username: who.username,
          roles: roles.map((r) => r.id),
          switchId: sw,
          method: 'GET',
          path: read.path,
        });
      }
      for (const r of results) {
        if (!r.ok && r.status !== 404) {
          evidence.push({
            switchId: r.switchId,
            path: read.path,
            ok: false,
            lines: [],
            error: r.error ?? 'read failed',
          });
          continue;
        }
        // 404 = the path is absent there: an answer the expectations grade, not a failure.
        const data = r.ok ? r.data : undefined;
        const lines = evaluate(step.verify.expect, data, row.run.values, read.item);
        evidence.push({ switchId: r.switchId, path: read.path, ok: lines.every((l) => l.ok), lines });
        for (const [k, v] of Object.entries(captureFrom(step.verify.capture, data, row.run.values))) {
          captured[k] ??= v;
        }
      }
    }
    return { evidence, captured };
  }

  app.get('/api/v1/journeys', async (request, reply) => {
    const who = await caller(request, reply);
    if (!who) return reply;
    const parsed = ScopeQuery.safeParse(request.query);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'kind (switch|group) and id required', request.url);
    const switches = await scopeSwitches(parsed.data);
    if (!switches)
      return problem(
        reply,
        404,
        'Not Found',
        `no switches in ${parsed.data.kind} ${parsed.data.id}`,
        request.url,
      );
    const roles = await getUserRoles(who.sub);
    return { journeys: JOURNEYS.map((j) => ({ ...j, locked: lockReason(j, roles, switches) })) };
  });

  app.get('/api/v1/me/journeys', async (request, reply) => {
    const who = await caller(request, reply);
    if (!who) return reply;
    const parsed = ScopeQuery.safeParse(request.query);
    const runs = await listRuns(who.sub, parsed.success ? parsed.data : undefined);
    return { runs: runs.map(viewOf) };
  });

  app.post('/api/v1/me/journeys', async (request, reply) => {
    const who = await caller(request, reply);
    if (!who) return reply;
    const parsed = StartBody.safeParse(request.body);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'journey and scope {kind,id} required', request.url);
    const journey = journeyOf(parsed.data.journey);
    if (!journey) return problem(reply, 404, 'Not Found', `no journey ${parsed.data.journey}`, request.url);
    const { scope } = parsed.data;
    const switches = await scopeSwitches(scope);
    if (!switches)
      return problem(reply, 404, 'Not Found', `no switches in ${scope.kind} ${scope.id}`, request.url);
    const roles = await getUserRoles(who.sub);
    const outside = switches.find((sw) => !mayAccessSwitch(roles, sw.groups));
    if (outside) return problem(reply, 403, 'Forbidden', `no role covers switch ${outside.id}`, request.url);
    // Resumable: starting a journey already under way here picks it up, never restarts it.
    const active = await findActive(who.sub, journey.key, scope);
    if (active) return viewOf(active);
    const row = await createRun(
      who.sub,
      journey.key,
      scope,
      switches.map((s) => s.id),
      startRun(journey, new Date().toISOString()),
    );
    return reply.code(201).send(viewOf(row));
  });

  app.get('/api/v1/me/journeys/:id', async (request, reply) => {
    const who = await caller(request, reply);
    if (!who) return reply;
    const row = await getRun((request.params as { id: string }).id, who.sub);
    if (!row) return problem(reply, 404, 'Not Found', 'no such journey run', request.url);
    return viewOf(row);
  });

  app.post('/api/v1/me/journeys/:id/steps/:step', async (request, reply) => {
    const who = await caller(request, reply);
    if (!who) return reply;
    const { id, step: stepId } = request.params as { id: string; step: string };
    const parsed = StepBody.safeParse(request.body);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'op (submit|verify|skip) required', request.url);
    const row = await getRun(id, who.sub);
    if (!row) return problem(reply, 404, 'Not Found', 'no such journey run', request.url);
    const journey = journeyOf(row.journey);
    if (!journey)
      return problem(reply, 410, 'Gone', `journey ${row.journey} is no longer offered`, request.url);
    if (row.run.state === 'done' || row.run.state === 'abandoned') {
      return problem(reply, 409, 'Conflict', 'this journey has finished', request.url);
    }
    if (row.run.current !== stepId) {
      return problem(reply, 409, 'Conflict', `step ${stepId} is not the current step`, request.url);
    }
    const index = journey.steps.findIndex((s) => s.id === stepId);
    const step = journey.steps[index];
    if (!step) return problem(reply, 404, 'Not Found', `no step ${stepId}`, request.url);
    const now = new Date().toISOString();
    const { op } = parsed.data;

    let next: RunState;
    if (op === 'submit') {
      if (step.kind !== 'input')
        return problem(reply, 400, 'Bad Request', 'only input steps take values', request.url);
      const result = validateInputs(step, parsed.data.values ?? {});
      if ('errors' in result) {
        return problem(reply, 400, 'Bad Request', 'some values are invalid', request.url, {
          errors: result.errors,
        });
      }
      const values = {
        ...row.run.values,
        ...Object.fromEntries(Object.entries(result.values).map(([k, v]) => [`${stepId}.${k}`, v])),
      };
      next = moveOn(
        journey,
        { ...row.run, values, steps: { ...row.run.steps, [stepId]: { status: 'done', at: now } } },
        index,
        now,
      );
    } else if (op === 'skip') {
      if (!step.skippable)
        return problem(reply, 400, 'Bad Request', `${step.title} cannot be skipped`, request.url);
      next = moveOn(
        journey,
        {
          ...row.run,
          steps: { ...row.run.steps, [stepId]: { status: 'skipped', at: now, note: 'Skipped' } },
        },
        index,
        now,
      );
    } else {
      if (step.kind === 'input')
        return problem(reply, 400, 'Bad Request', 'input steps have no check', request.url);
      try {
        const { evidence, captured } = await check(who, row, journey, stepId);
        next = recordCheck(journey, row.run, stepId, evidence, captured, now);
      } catch (err) {
        if (err instanceof RefError) return problem(reply, 400, 'Bad Request', err.message, request.url);
        throw err;
      }
    }
    const view = await persist(request, reply, who, row, next);
    return view ?? reply;
  });

  app.delete('/api/v1/me/journeys/:id', async (request, reply) => {
    const who = await caller(request, reply);
    if (!who) return reply;
    const row = await getRun((request.params as { id: string }).id, who.sub);
    if (!row) return problem(reply, 404, 'Not Found', 'no such journey run', request.url);
    if (row.run.state === 'done' || row.run.state === 'abandoned') {
      return problem(reply, 409, 'Conflict', 'this journey has finished', request.url);
    }
    const view = await persist(request, reply, who, row, { ...row.run, state: 'abandoned', current: null });
    return view ?? reply;
  });
}
