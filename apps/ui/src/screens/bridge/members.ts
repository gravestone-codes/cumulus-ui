/**
 * Bridge lenses over other stores, kept pure for tests. Member ports are
 * interface (S1) config — `/interface/{id}/bridge/domain/{domain}` — so the
 * Ports tab reads the interface collection, never a second port fetcher.
 */
import { displayValue } from '../iface/ConfigTab.js';
import { getPath, ifaceState } from '../../lib/format.js';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One member port as display values ('' = unset, inherits from the domain). */
export interface PortView extends Obj {
  state: string;
  access: string;
  vlans: string;
  untagged: string;
  learning: string;
}

/**
 * A switch's member ports of `domain`: applied interface config in, one
 * PortView per member out. Undefined when the interface read is missing.
 */
export function domainPorts(
  applied: Record<string, Obj> | undefined,
  oper: Record<string, Obj> | undefined,
  domain: string,
): Record<string, PortView> | undefined {
  if (!applied) return undefined;
  const out: Record<string, PortView> = {};
  for (const [name, iface] of Object.entries(applied)) {
    const m = getPath(iface, `bridge/domain/${domain}`);
    if (!isObj(m)) continue;
    out[name] = {
      state: ifaceState(oper?.[name]) ?? '',
      access: displayValue(m['access']),
      vlans: displayValue(m['vlan']),
      untagged: displayValue(m['untagged']),
      learning: displayValue(m['learning']),
    };
  }
  return out;
}

/** A domain's VLANs (vid → VLAN object); undefined when the domain is absent. */
export function domainVlans(domain: Obj | undefined): Record<string, Obj> | undefined {
  if (!domain) return undefined;
  const vlans = domain['vlan'];
  if (!isObj(vlans)) return {};
  return Object.fromEntries(Object.entries(vlans).map(([vid, v]) => [vid, isObj(v) ? v : {}]));
}
