/**
 * Journey engine: pure functions over the catalog (no DB, no switch). Fills
 * refs, validates inputs, plans writes, evaluates gate reads, and moves a run
 * between steps. routes.ts does the I/O; everything decidable lives here so
 * it is unit-tested without a database.
 */
import type {
  Capture,
  CallTemplate,
  Expect,
  InputField,
  Journey,
  JourneyStep,
  Outcome,
  Verify,
} from './catalog.js';

/** A captured value: scalars from inputs and reads, lists from `list` inputs. */
export type Value = string | number | string[];
/** Captured values keyed `step.name`. */
export type Values = Record<string, Value>;

/** A ref with no value where one is required (path segment, embedded text). */
export class RefError extends Error {}

const REF = /\{\{([\w.-]+)\}\}/g;
const WHOLE = /^\{\{([\w.-]+)\}\}$/;
const OMIT = Symbol('omit');

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isEmpty = (v: Value | undefined): v is undefined =>
  v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

function lookup(values: Values, ref: string, item?: string): Value | undefined {
  return ref === 'item' ? item : values[ref];
}

function fill(text: string, values: Values, item: string | undefined, encode: boolean): string {
  return text.replace(REF, (_, ref: string) => {
    const v = lookup(values, ref, item);
    if (isEmpty(v) || Array.isArray(v)) throw new RefError(`no value for ${ref}`);
    return encode ? encodeURIComponent(String(v)) : String(v);
  });
}

/**
 * Switch path from a template: each ref fills one encoded segment.
 * @throws RefError when a ref has no value
 */
export function resolvePath(tmpl: string, values: Values, item?: string): string {
  return fill(tmpl, values, item, true);
}

/** Display text (notes, expected values): a missing ref reads `—`, never throws. */
export function resolveText(tmpl: string, values: Values, item?: string): string {
  return tmpl.replace(REF, (_, ref: string) => {
    const v = lookup(values, ref, item);
    return isEmpty(v) ? '—' : Array.isArray(v) ? v.join(', ') : String(v);
  });
}

/** `at` path to segments; a ref fills a whole segment verbatim (prefix keys keep their slash). */
export function resolveAt(at: string, values: Values, item?: string): string[] {
  return at === '' ? [] : at.split('/').map((seg) => fill(seg, values, item, false));
}

function resolveValue(v: unknown, values: Values, item: string | undefined): unknown {
  if (typeof v === 'string') {
    const whole = WHOLE.exec(v);
    if (whole) {
      const x = lookup(values, whole[1] as string, item);
      return isEmpty(x) ? OMIT : x;
    }
    return fill(v, values, item, false);
  }
  if (!isObj(v)) return v;
  const out: Obj = {};
  for (const [k, child] of Object.entries(v)) {
    const val = resolveValue(child, values, item);
    if (val === OMIT) continue;
    const whole = WHOLE.exec(k);
    if (!whole) {
      out[fill(k, values, item, false)] = val;
      continue;
    }
    const key = lookup(values, whole[1] as string, item);
    if (isEmpty(key)) continue;
    for (const one of Array.isArray(key) ? key : [key]) out[String(one)] = val;
  }
  return out;
}

/** Request body from a template: whole-string refs keep their type, lists expand keys, empty optionals drop out. */
export function resolveBody(body: Obj, values: Values, item?: string): Obj {
  return resolveValue(body, values, item) as Obj;
}

/** One concrete NVUE write, as ChangeFlow stages it. */
export interface PlannedCall {
  method: 'PATCH' | 'DELETE';
  path: string;
  body?: Obj;
}

function itemsOf(each: string | undefined, values: Values): Array<string | undefined> {
  if (!each) return [undefined];
  const v = values[each];
  if (isEmpty(v)) throw new RefError(`no value for ${each}`);
  return (Array.isArray(v) ? v : [v]).map(String);
}

/**
 * Concrete writes for a change step, in order (`each` templates repeat per item).
 * @throws RefError when a required ref has no value
 */
export function planCalls(calls: CallTemplate[], values: Values): PlannedCall[] {
  return calls.flatMap((c) =>
    itemsOf(c.each, values).map((item) => ({
      method: c.method,
      path: resolvePath(c.path, values, item),
      ...(c.body ? { body: resolveBody(c.body, values, item) } : {}),
    })),
  );
}

/** Gate reads of a verify: one per `each` item, or the single path. */
export function verifyReads(v: Verify, values: Values): Array<{ path: string; item?: string }> {
  return itemsOf(v.each, values).map((item) => ({
    path: resolvePath(v.path, values, item),
    ...(item !== undefined ? { item } : {}),
  }));
}

/** Everything found at `segs` (`*` fans out over keys); null/undefined never count. */
export function valuesAt(data: unknown, segs: string[]): unknown[] {
  let cur: unknown[] = [data];
  for (const seg of segs) {
    cur = cur.flatMap((c) => {
      if (!isObj(c)) return [];
      if (seg === '*') return Object.values(c);
      return Object.prototype.hasOwnProperty.call(c, seg) ? [c[seg]] : [];
    });
  }
  return cur.filter((x) => x !== undefined && x !== null);
}

/** One evaluated expectation, phrased for the operator. */
export interface CheckLine {
  ok: boolean;
  text: string;
}

const shown = (vals: unknown[]) => vals.filter(isScalar).slice(0, 3).map(String).join(', ');

/** Evaluate a verify's expectations against one read result (`undefined` = the path is absent). */
export function evaluate(expects: Expect[], data: unknown, values: Values, item?: string): CheckLine[] {
  return expects.map((e) => {
    const segs = resolveAt(e.at, values, item);
    const label = segs.length === 0 ? 'path' : segs.join(' › ');
    let found = valuesAt(data, segs);
    if (e.op === 'equals') {
      const want = resolveText(e.value, values, item);
      const ok = found.some((v) => isScalar(v) && String(v) === want);
      return {
        ok,
        text: ok ? `${label} is ${want}` : `${label} is ${shown(found) || 'unset'}, expected ${want}`,
      };
    }
    if (e.except !== undefined) {
      const skip = resolveText(e.except, values, item);
      found = found.filter((v) => !(isScalar(v) && String(v) === skip));
    }
    const list = shown(found);
    if (e.op === 'exists') {
      const ok = found.length > 0;
      return { ok, text: ok ? `${label} present${list ? ` (${list})` : ''}` : `${label} missing` };
    }
    const ok = found.length === 0;
    return { ok, text: ok ? `${label} absent` : `${label} still present${list ? ` (${list})` : ''}` };
  });
}

/** Values a passing read hands to later steps (first scalar found per capture). */
export function captureFrom(
  capture: Record<string, Capture> | undefined,
  data: unknown,
  values: Values,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries(capture ?? {})) {
    const { at, except } = typeof spec === 'string' ? { at: spec, except: undefined } : spec;
    const skip = except === undefined ? undefined : resolveText(except, values);
    const hit = valuesAt(data, resolveAt(at, values))
      .filter(isScalar)
      .map(String)
      .find((v) => v !== skip);
    if (hit !== undefined) out[name] = hit;
  }
  return out;
}

const IPV4_PREFIX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

/** Parse an IPv4 CIDR strictly; null when malformed. */
export function parsePrefix(text: string): { addr: number; len: number } | null {
  const m = IPV4_PREFIX.exec(text);
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  const len = Number(m[5]);
  if (octets.some((o) => o > 255) || len > 32) return null;
  return { addr: octets.reduce((a, o) => a * 256 + o, 0), len };
}

/** Network address of a prefix (`10.1.10.1/24` → `10.1.10.0/24`). */
export function network(text: string): string {
  const p = parsePrefix(text);
  if (!p) throw new RefError(`not an IPv4 prefix: ${text}`);
  const mask = p.len === 0 ? 0 : (0xffffffff << (32 - p.len)) >>> 0;
  const n = (p.addr & mask) >>> 0;
  return `${[n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')}/${p.len}`;
}

function checkField(f: InputField, text: string): { value?: Value; error?: string } {
  const bad = f.hint ? `Invalid format — ${f.hint}.` : 'Invalid format.';
  switch (f.kind) {
    case 'number': {
      if (!/^\d+$/.test(text)) return { error: 'Must be a whole number.' };
      const n = Number(text);
      if (f.min !== undefined && n < f.min) return { error: `Must be at least ${f.min}.` };
      if (f.max !== undefined && n > f.max) return { error: `Must be at most ${f.max}.` };
      return { value: n };
    }
    case 'prefix':
      return parsePrefix(text) ? { value: text } : { error: bad };
    case 'choice':
      return f.choices?.includes(text) ? { value: text } : { error: `Pick one of ${f.choices?.join(', ')}.` };
    case 'list': {
      const items = [...new Set(text.split(/[\s,]+/).filter(Boolean))];
      const re = f.pattern ? new RegExp(f.pattern) : null;
      const wrong = items.find((i) => re && !re.test(i));
      return wrong ? { error: `${wrong}: ${bad}` } : { value: items };
    }
    default:
      return !f.pattern || new RegExp(f.pattern).test(text) ? { value: text } : { error: bad };
  }
}

/** Validated values of an input step (by field name, plus derived ones), or per-field errors. */
export function validateInputs(
  step: Extract<JourneyStep, { kind: 'input' }>,
  raw: Record<string, unknown>,
): { values: Record<string, Value> } | { errors: Record<string, string> } {
  const text = (name: string) => {
    const v = raw[name];
    return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  };
  const values: Record<string, Value> = {};
  const errors: Record<string, string> = {};
  for (const f of step.fields) {
    const t = text(f.name) || (f.default ?? '');
    const required =
      !f.optional || (f.requiredWhen !== undefined && text(f.requiredWhen.field) === f.requiredWhen.equals);
    if (t === '') {
      if (required) errors[f.name] = 'Required.';
      continue;
    }
    const { value, error } = checkField(f, t);
    if (error) errors[f.name] = error;
    else if (value !== undefined) values[f.name] = value;
  }
  if (Object.keys(errors).length > 0) return { errors };
  for (const [name, d] of Object.entries(step.derive ?? {})) {
    const src = values[d.from];
    if (typeof src === 'string') values[name] = network(src);
  }
  return { values };
}

/** Whether a step's `when` holds for the values captured so far. */
export function applies(step: JourneyStep, values: Values): boolean {
  if (!step.when) return true;
  const v = values[step.when.ref];
  if (isEmpty(v)) return false;
  return step.when.equals === undefined || String(v) === step.when.equals;
}

/** Per-switch result of one gate read. */
export interface Evidence {
  switchId: string;
  path: string;
  ok: boolean;
  lines: CheckLine[];
  /** The read itself failed (denied, unreachable): the check could not run. */
  error?: string;
}

export interface StepState {
  /** done = input taken or check passed; branched = a check failed into its `onFail` outcome. */
  status: 'done' | 'skipped' | 'blocked' | 'branched';
  at: string;
  evidence?: Evidence[];
  note?: string;
}

export type RunStatus = 'in-progress' | 'blocked' | 'done' | 'abandoned';

/** Everything a run carries between requests. */
export interface RunState {
  state: RunStatus;
  /** Step awaiting the operator; null once finished. */
  current: string | null;
  steps: Record<string, StepState>;
  values: Values;
  /** Terminal outcome (`goto: 'end'` notes). */
  note: string | null;
}

/** Fresh run: positioned on the first applicable step. */
export function startRun(journey: Journey, now: string): RunState {
  return moveOn(journey, { state: 'in-progress', current: null, steps: {}, values: {}, note: null }, -1, now);
}

/** Advance past index `from`, skipping steps whose `when` fails; finishes the run after the last. */
export function moveOn(journey: Journey, run: RunState, from: number, now: string): RunState {
  const steps = { ...run.steps };
  for (let i = from + 1; i < journey.steps.length; i++) {
    const step = journey.steps[i] as JourneyStep;
    if (applies(step, run.values)) return { ...run, steps, state: 'in-progress', current: step.id };
    steps[step.id] = { status: 'skipped', at: now, note: 'Not applicable' };
  }
  return { ...run, steps, state: 'done', current: null };
}

/** Follow an explicit outcome: `end` finishes with its note, a step id jumps there. */
export function follow(journey: Journey, run: RunState, outcome: Outcome, now: string): RunState {
  const note = outcome.note ? resolveText(outcome.note, run.values) : null;
  if (outcome.goto === 'end') return { ...run, state: 'done', current: null, note };
  const at = journey.steps.findIndex((s) => s.id === outcome.goto);
  if (at === -1) throw new Error(`journey ${journey.key}: unknown goto ${outcome.goto}`);
  return { ...moveOn(journey, run, at - 1, now), note };
}

/**
 * Record a gate result on the current step and move: pass → next (or
 * `onPass`); fail → `onFail` when the step declares one, else blocked in place.
 * A read that could not run (denied, unreachable) always blocks: no answer is
 * not a "no" to branch on.
 */
export function recordCheck(
  journey: Journey,
  run: RunState,
  stepId: string,
  evidence: Evidence[],
  captured: Record<string, string>,
  now: string,
): RunState {
  const index = journey.steps.findIndex((s) => s.id === stepId);
  const step = journey.steps[index] as JourneyStep;
  const ok = evidence.length > 0 && evidence.every((e) => e.ok);
  if (!ok) {
    const unread = evidence.length === 0 || evidence.some((e) => e.error !== undefined);
    const onFail = step.kind === 'verify' && !unread ? step.onFail : undefined;
    const steps = {
      ...run.steps,
      [stepId]: { status: onFail ? 'branched' : 'blocked', at: now, evidence },
    } as Record<string, StepState>;
    return onFail ? follow(journey, { ...run, steps }, onFail, now) : { ...run, steps, state: 'blocked' };
  }
  const values = {
    ...run.values,
    ...Object.fromEntries(Object.entries(captured).map(([k, v]) => [`${stepId}.${k}`, v])),
  };
  const next = {
    ...run,
    values,
    steps: { ...run.steps, [stepId]: { status: 'done' as const, at: now, evidence } },
  };
  const onPass = step.kind === 'verify' ? step.onPass : undefined;
  return onPass ? follow(journey, next, onPass, now) : moveOn(journey, next, index, now);
}

/** Every switch call a journey can make, refs blanked: the cosmetic pre-check behind "locked". */
export function gatedCalls(journey: Journey): Array<{ step: string; method: string; path: string }> {
  const blank = (p: string) => p.replace(REF, '_');
  return journey.steps.flatMap((s) => {
    if (s.kind === 'input') return [];
    const reads = [{ step: s.title, method: 'GET', path: blank(s.verify.path) }];
    const writes =
      s.kind === 'change'
        ? s.calls.map((c) => ({ step: s.title, method: c.method, path: blank(c.path) }))
        : [];
    return [...writes, ...reads];
  });
}
