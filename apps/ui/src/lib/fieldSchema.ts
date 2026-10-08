/**
 * Spec leaf → form field, kept pure for tests. The backend serves the PATCH
 * schema (`/spec/fields`); this decides how one leaf edits (kind, choices,
 * bounds) and how a form value becomes an NVUE PATCH body. No switch-derived
 * constants: every choice comes from the schema.
 */
/**
 * How a leaf edits. `keyed` = one-of map keys (`state: {up: {}}`,
 * `breakout: {"4x": {}}`); `set` = many map keys (addresses, members).
 */
export type FieldKind = 'number' | 'choice' | 'keyed' | 'set' | 'text';

type Schema = Record<string, unknown>;

/** Numbers in keys sort as numbers (VLAN 2 before 10). */
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

const isObj = (v: unknown): v is Schema => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Sub-schema at a slash path of property names. Undefined when the spec lacks it. */
export function leafSchema(schema: unknown, leaf: string): Schema | undefined {
  let node: unknown = schema;
  for (const seg of leaf.split('/').filter(Boolean)) {
    const props = isObj(node) ? node['properties'] : undefined;
    node = isObj(props) ? props[seg] : undefined;
  }
  return isObj(node) ? node : undefined;
}

function enumValues(s: unknown): string[] {
  if (!isObj(s)) return [];
  const own = Array.isArray(s['enum']) ? s['enum'] : [];
  const branches = Array.isArray(s['anyOf']) ? s['anyOf'].flatMap(enumValues) : [];
  return [...own.filter((v) => typeof v === 'string' || typeof v === 'number').map(String), ...branches];
}

/** Every value a leaf offers: enum, anyOf enums, map-key names, or empty-object keys (state up/down). */
export function choicesOf(s: Schema | undefined): string[] {
  if (!s) return [];
  const keys = enumValues(s['x-propertyNames']);
  const props = isObj(s['properties']) ? s['properties'] : {};
  const flags =
    keys.length === 0 && Object.keys(props).length > 0 && Object.values(props).every((p) => isTagObject(p))
      ? Object.keys(props)
      : [];
  return [...new Set([...enumValues(s), ...keys, ...flags])];
}

/** An object leaf with no properties of its own (`{up: {}}` style tag). */
function isTagObject(p: unknown): boolean {
  return isObj(p) && (!isObj(p['properties']) || Object.keys(p['properties']).length === 0) && !p['enum'];
}

/** Bounds for numeric leaves (spec minimum/maximum, incl. anyOf branches). */
export function boundsOf(s: Schema | undefined): { min?: number; max?: number } {
  if (!s) return {};
  const branches = Array.isArray(s['anyOf']) ? s['anyOf'].filter(isObj) : [];
  const pick = (k: 'minimum' | 'maximum') =>
    typeof s[k] === 'number'
      ? (s[k] as number)
      : (branches.map((b) => b[k]).find((v) => typeof v === 'number') as number | undefined);
  return { min: pick('minimum'), max: pick('maximum') };
}

/**
 * Free-entry kind of an anyOf that mixes a value branch with keywords
 * (`untagged: 1–4094 | none`, `mac-address: <mac> | auto`); the keywords
 * stay valid entries. Undefined when the leaf is keywords only.
 */
function freeKind(s: Schema): 'number' | 'text' | undefined {
  const branches = Array.isArray(s['anyOf']) ? s['anyOf'].filter(isObj) : [];
  if (!branches.some((b) => enumValues(b).length > 0)) return undefined;
  for (const b of branches) {
    if (enumValues(b).length > 0) continue;
    if (b['type'] === 'integer' || b['type'] === 'number') return 'number';
    if (b['type'] === 'string') return 'text';
  }
  return undefined;
}

/** Kind from the schema shape; `hint` wins (spec-less leaves such as description). */
export function kindOf(s: Schema | undefined, hint?: FieldKind): FieldKind {
  if (hint) return hint;
  if (!s) return 'text';
  const free = freeKind(s);
  if (free) return free;
  if (enumValues(s).length > 0) return 'choice';
  if (s['type'] === 'integer' || s['type'] === 'number') return 'number';
  if (isObj(s['additionalProperties']) || s['x-propertyNames'] !== undefined) {
    return enumValues(s['x-propertyNames']).length > 0 ? 'keyed' : 'set';
  }
  if (choicesOf(s).length > 0) return 'keyed';
  return 'text';
}

/** A leaf's current value as form text (sets → sorted keys joined by newline). '' when unset. */
export function decodeValue(kind: FieldKind, raw: unknown): string {
  if (raw === undefined || raw === null) return '';
  if (kind === 'keyed') return isObj(raw) ? (Object.keys(raw)[0] ?? '') : String(raw);
  if (kind === 'set') return isObj(raw) ? Object.keys(raw).sort(natural).join('\n') : '';
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

/** Form text → the JSON value NVUE expects at the leaf. Sets are handled by `setDelta`. */
export function encodeValue(kind: FieldKind, text: string, choices: string[] = []): unknown {
  if (kind === 'number') return choices.includes(text) ? text : Number(text);
  if (kind === 'keyed') return { [text]: {} };
  // Numeric enums (lanes: 1|2|4|8) travel as numbers.
  if (kind === 'choice' && choices.length > 0 && choices.every((c) => /^\d+$/.test(c))) return Number(text);
  return text;
}

/** Set field text (one entry per line) → normalized unique entries. */
export function setEntries(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].sort(natural);
}

/** Added and removed entries between two set texts. */
export function setDelta(before: string, after: string): { add: string[]; remove: string[] } {
  const a = setEntries(before);
  const b = setEntries(after);
  return { add: b.filter((x) => !a.includes(x)), remove: a.filter((x) => !b.includes(x)) };
}

/** Write `value` at a slash path into a fresh nested object. */
export function nest(path: string, value: unknown): Record<string, unknown> {
  const segs = path.split('/').filter(Boolean);
  return segs.reduceRight<unknown>((acc, seg) => ({ [seg]: acc }), value) as Record<string, unknown>;
}

/** Deep-merge plain objects (PATCH bodies built leaf by leaf). */
export function mergeBodies(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = isObj(out[k]) && isObj(v) ? mergeBodies(out[k] as Record<string, unknown>, v) : v;
  }
  return out;
}

/** Validation message for a value, or null when acceptable. */
export function invalidReason(kind: FieldKind, text: string, s: Schema | undefined): string | null {
  if (kind === 'number' && text !== '' && !choicesOf(s).includes(text)) {
    const n = Number(text);
    const { min, max } = boundsOf(s);
    if (!Number.isInteger(n)) return 'Must be a whole number.';
    if (min !== undefined && n < min) return `Must be at least ${min}.`;
    if (max !== undefined && n > max) return `Must be at most ${max}.`;
  }
  return null;
}
