/**
 * InterfacePicker options (R11), derived from the backend interface list of
 * every switch in scope. An option is an interface name (the `S1` identity)
 * plus which members have it, so a group picker can say `swp5 · 1/2`.
 */

type Obj = Record<string, unknown>;

/** One pickable interface across the scope. */
export interface PickerOption {
  name: string;
  /** NVUE `type` (swp, bond, sub, …) from the first member that has it. */
  type: string;
  /** Members that have this interface, in member order. */
  have: string[];
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Union of interfaces across members, optionally narrowed to `types`, minus `exclude`. */
export function pickerOptions(
  members: string[],
  lists: Record<string, Record<string, Obj> | undefined>,
  opts: { types?: string[]; exclude?: Iterable<string> } = {},
): PickerOption[] {
  const skip = new Set(opts.exclude ?? []);
  const found = new Map<string, PickerOption>();
  for (const sw of members) {
    for (const [name, obj] of Object.entries(lists[sw] ?? {})) {
      if (skip.has(name)) continue;
      const type = String(obj?.['type'] ?? '');
      if (opts.types && !opts.types.includes(type)) continue;
      const opt = found.get(name) ?? { name, type, have: [] };
      opt.have.push(sw);
      found.set(name, opt);
    }
  }
  return [...found.values()].sort((a, b) => byName(a.name, b.name));
}

/** Ports already enslaved to some bond on any member (`bond.member` keys of each bond). */
export function bondedPorts(lists: Record<string, Record<string, Obj> | undefined>): Set<string> {
  const out = new Set<string>();
  for (const list of Object.values(lists)) {
    for (const obj of Object.values(list ?? {})) {
      const member = (obj?.['bond'] as Obj | undefined)?.['member'];
      if (member && typeof member === 'object') for (const port of Object.keys(member)) out.add(port);
    }
  }
  return out;
}

/** Search (case-insensitive substring) and type filter; `type` '' means all. */
export function filterOptions(options: PickerOption[], query: string, type = ''): PickerOption[] {
  const q = query.trim().toLowerCase();
  return options.filter((o) => (!type || o.type === type) && (!q || o.name.toLowerCase().includes(q)));
}

/** Distinct types among the options, for the type filter. */
export const optionTypes = (options: PickerOption[]) =>
  [...new Set(options.map((o) => o.type).filter(Boolean))].sort(byName);

/** Picked names missing on some members, with the members that lack them. */
export function missingOn(
  options: PickerOption[],
  picked: string[],
  members: string[],
): Array<{ name: string; lacking: string[] }> {
  return picked.flatMap((name) => {
    const have = options.find((o) => o.name === name)?.have ?? [];
    const lacking = members.filter((sw) => !have.includes(sw));
    return lacking.length ? [{ name, lacking }] : [];
  });
}
