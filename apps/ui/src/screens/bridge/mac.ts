/**
 * MAC table lens (roadmap 3B.3), kept pure for tests. `GET
 * /bridge/domain/{id}/mac-table` returns a MAC-keyed map of entries plus a
 * `dynamic` action child — entries out, action state ignored. One flat row
 * per MAC per switch; group screens add the Switch column themselves.
 */

type Obj = Record<string, unknown>;

/** One learned MAC as table values ('' = unset on the switch). */
export interface MacView extends Obj {
  mac: string;
  vlan: string;
  iface: string;
  type: string;
  age: string;
}

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown): string => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return '';
  return String(v);
};

/**
 * A switch's MAC entries: key (or `mac` leaf) in, one MacView per learned
 * MAC out. Undefined when the read is missing (member lacks the domain).
 */
export function macEntries(table: Obj | undefined): Record<string, MacView> | undefined {
  if (!table) return undefined;
  const out: Record<string, MacView> = {};
  for (const [key, raw] of Object.entries(table)) {
    if (key === 'dynamic') continue;
    if (!isObj(raw)) continue;
    if ('@clear' in raw || 'state' in raw) continue;
    out[key] = {
      mac: text(raw['mac']) || key,
      vlan: text(raw['vlan']),
      iface: text(raw['interface']),
      type: text(raw['entry-type']),
      age: text(raw['age'] ?? raw['last-update']),
    };
  }
  return out;
}

/** Flat rows across the scope's present members, for the searchable table. */
export function macRows(
  present: string[],
  tables: Record<string, Record<string, MacView> | undefined>,
): Array<MacView & { sw: string }> {
  return present.flatMap((sw) => Object.values(tables[sw] ?? {}).map((m) => ({ ...m, sw })));
}

/** NVUE body flushing every dynamic entry on the domain (ActionRunner, routine class). */
export function clearAllBody(): Record<string, unknown> {
  return { '@clear': { state: 'start' } };
}

/** NVUE body flushing one dynamic MAC (the id rides in `parameters`). */
export function clearOneBody(mac: string): Record<string, unknown> {
  return { '@clear': { state: 'start', parameters: { 'mac-address-id': mac } } };
}
