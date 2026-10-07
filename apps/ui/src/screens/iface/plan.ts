/**
 * Edit planning, kept pure for tests: form state → per-switch NVUE calls →
 * fan-out rounds. A switch whose values already match gets no call at all,
 * so applies only touch switches with a real diff (design §4A).
 */
import type { StageCall } from '../../lib/api.js';
import {
  encodeValue,
  mergeBodies,
  nest,
  setDelta,
  setEntries,
  type FieldKind,
} from '../../lib/fieldSchema.js';

export interface PlanField {
  /** Leaf path from the interface root (`link/mtu`). */
  path: string;
  label: string;
  kind: FieldKind;
  choices: string[];
  perSwitch: boolean;
  /** Validation for a target value; null = fine. */
  invalid: (text: string) => string | null;
}

/** Shared draft: path → value; absent = keep each switch's own value. */
export type SharedDraft = Record<string, string | undefined>;
/** Per-switch draft: path → switch → value; absent = keep. */
export type PerSwitchDraft = Record<string, Record<string, string | undefined>>;

export type Plan =
  { ok: true; calls: Record<string, StageCall[]>; unchanged: string[] } | { ok: false; error: string };

/** The value a member should end with for one field. */
function target(
  f: PlanField,
  sw: string,
  current: string,
  shared: SharedDraft,
  perSwitch: PerSwitchDraft,
): string {
  const v = f.perSwitch ? perSwitch[f.path]?.[sw] : shared[f.path];
  return v === undefined ? current : v;
}

const sameValue = (kind: FieldKind, a: string, b: string) =>
  kind === 'set' ? setEntries(a).join('\n') === setEntries(b).join('\n') : a === b;

/**
 * Build every member's calls. `current[sw][path]` is the decoded applied
 * value. Clears and set-key removals are `null` in the one PATCH — NVUE's
 * documented unset; leaves have no DELETE route of their own.
 */
export function planCalls(
  ifacePath: string,
  members: string[],
  fields: PlanField[],
  current: Record<string, Record<string, string>>,
  shared: SharedDraft,
  perSwitch: PerSwitchDraft,
): Plan {
  const calls: Record<string, StageCall[]> = {};
  const unchanged: string[] = [];
  for (const sw of members) {
    let body: Record<string, unknown> = {};
    for (const f of fields) {
      const now = current[sw]?.[f.path] ?? '';
      const want = target(f, sw, now, shared, perSwitch);
      if (sameValue(f.kind, now, want)) continue;
      if (f.kind === 'set') {
        const { add, remove } = setDelta(now, want);
        const keys = [...add.map((k) => [k, {}]), ...remove.map((k) => [k, null])];
        body = mergeBodies(body, nest(f.path, Object.fromEntries(keys)));
        continue;
      }
      if (want === '') {
        body = mergeBodies(body, nest(f.path, null));
        continue;
      }
      const reason = f.invalid(want);
      if (reason) return { ok: false, error: `${f.label}${members.length > 1 ? ` (${sw})` : ''}: ${reason}` };
      body = mergeBodies(body, nest(f.path, encodeValue(f.kind, want, f.choices)));
    }
    if (Object.keys(body).length > 0) calls[sw] = [{ path: ifacePath, method: 'PATCH', body }];
    else unchanged.push(sw);
  }
  if (Object.keys(calls).length === 0) return { ok: false, error: 'No changes to stage.' };
  return { ok: true, calls, unchanged };
}

/** One group stage request: same path + method, per-member bodies, exclusive on a member's first call. */
export interface StageRound {
  path: string;
  method: 'PATCH' | 'DELETE';
  bodies?: Record<string, Record<string, unknown>>;
  members: string[];
  exclusive: boolean;
}

/**
 * Turn per-member call lists into group stage requests. A member's first
 * call is exclusive (refuses unrelated staged work); later ones pile on.
 */
export function stageRounds(calls: Record<string, StageCall[]>): StageRound[] {
  const rounds: StageRound[] = [];
  const started = new Set<string>();
  const queue = Object.entries(calls).flatMap(([sw, list]) => list.map((c, i) => ({ sw, c, i })));
  const order = [...new Set(queue.map((q) => `${q.i}|${q.c.method}|${q.c.path}`))];
  for (const key of order) {
    const items = queue.filter((q) => `${q.i}|${q.c.method}|${q.c.path}` === key);
    for (const exclusive of [true, false]) {
      const part = items.filter((q) => started.has(q.sw) !== exclusive);
      if (part.length === 0) continue;
      const first = part[0]!.c;
      rounds.push({
        path: first.path,
        method: first.method,
        members: part.map((q) => q.sw),
        exclusive,
        ...(first.method === 'PATCH'
          ? { bodies: Object.fromEntries(part.map((q) => [q.sw, q.c.body ?? {}])) }
          : {}),
      });
    }
    for (const q of items) started.add(q.sw);
  }
  return rounds;
}
