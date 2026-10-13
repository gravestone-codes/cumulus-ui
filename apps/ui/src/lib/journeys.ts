/**
 * Journey runner helpers: pure presentation over the served catalog and run
 * state (the decisions live in the backend engine). A change step's plan is
 * shown as the `nv set` / `nv unset` lines it amounts to before ChangeFlow
 * stages it.
 */
import type { JourneyRun, JourneyStepDef, StageCall } from './api.js';
import { cliToken, toCommands } from './nvconfig.js';

/** CLI lines one planned write amounts to (`PATCH /vrf/RED {table:auto}` → `nv set vrf RED table auto`). */
export function callCommands(call: StageCall): string[] {
  const segs = call.path
    .split('/')
    .filter(Boolean)
    .map((s) => cliToken(decodeURIComponent(s)));
  if (call.method === 'DELETE') return [`nv unset ${segs.join(' ')}`];
  const body = call.body ?? {};
  return Object.keys(body).length === 0 ? [`nv set ${segs.join(' ')}`] : toCommands(body, segs);
}

/** Where a step stands in a run, for the progress rail. */
export type RailStatus = 'done' | 'skipped' | 'blocked' | 'branched' | 'current' | 'pending';

/** Rail rows for a run: recorded status, else current or pending. */
export function railOf(
  steps: JourneyStepDef[],
  run: JourneyRun,
): Array<{ id: string; title: string; status: RailStatus }> {
  return steps.map((s) => {
    const st = run.steps[s.id];
    const status: RailStatus =
      s.id === run.current ? (st?.status === 'blocked' ? 'blocked' : 'current') : (st?.status ?? 'pending');
    return { id: s.id, title: s.title, status };
  });
}

/** The same planned writes for every member (journeys mirror one change across the scope). */
export function perMember(plan: StageCall[], members: string[]): Record<string, StageCall[]> {
  return Object.fromEntries(members.map((m) => [m, plan]));
}
