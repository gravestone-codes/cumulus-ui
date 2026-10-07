/**
 * Group lens over per-switch objects, kept pure for tests: one interface
 * across members either agrees (`same`), disagrees (`mixed`, with who has
 * what), or is missing everywhere (`none`). Switches without the object are
 * reported apart so "absent on leaf-04" never reads as a value.
 */

export type Merged =
  | { kind: 'same'; value: string }
  | { kind: 'mixed'; groups: Array<{ value: string; switches: string[] }> }
  | { kind: 'none' };

/** Merge one decoded value per present switch. Groups sort by size, then value. */
export function mergeValues(values: Record<string, string>): Merged {
  const by = new Map<string, string[]>();
  for (const [sw, v] of Object.entries(values)) by.set(v, [...(by.get(v) ?? []), sw]);
  if (by.size === 0) return { kind: 'none' };
  if (by.size === 1) {
    const [value] = [...by.keys()];
    return { kind: 'same', value: value ?? '' };
  }
  const groups = [...by.entries()]
    .map(([value, switches]) => ({ value, switches: switches.sort() }))
    .sort((a, b) => b.switches.length - a.switches.length || a.value.localeCompare(b.value));
  return { kind: 'mixed', groups };
}

/** Members holding the object vs members lacking it, in input order. */
export function presence<T>(
  members: string[],
  objects: Record<string, T | undefined>,
): { present: string[]; absent: string[] } {
  const present = members.filter((m) => objects[m] !== undefined);
  return { present, absent: members.filter((m) => !present.includes(m)) };
}

/** Majority value of a mixed merge (first group); the "Align all to …" target. */
export function majority(m: Merged): string | undefined {
  return m.kind === 'same' ? m.value : m.kind === 'mixed' ? m.groups[0]?.value : undefined;
}

/**
 * Pattern fill for per-switch values: `{n}` = 1-based member index, `{2n+1}`
 * style linear terms allowed, `{sw}` = switch id.
 * @example fillPattern('10.0.0.{2n-1}/31', ['a', 'b']) → { a: '10.0.0.1/31', b: '10.0.0.3/31' }
 */
export function fillPattern(pattern: string, members: string[]): Record<string, string> {
  return Object.fromEntries(
    members.map((sw, i) => {
      const n = i + 1;
      const text = pattern
        .replace(/\{sw\}/g, sw)
        .replace(
          /\{\s*(\d*)\s*n\s*(?:([+-])\s*(\d+))?\s*\}/g,
          (_m, mul: string, op?: string, add?: string) => {
            const k = mul === '' ? 1 : Number(mul);
            const c = add === undefined ? 0 : Number(add) * (op === '-' ? -1 : 1);
            return String(k * n + c);
          },
        );
      return [sw, text];
    }),
  );
}
