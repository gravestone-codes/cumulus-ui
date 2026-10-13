/**
 * Troubleshooting reads as rows: RIB routes (with resolved next hops and a
 * longest-prefix lookup), ARP/ND, MAC table, LLDP and BGP peers. Pure
 * parsers over NVUE operational shapes (pinned by tests); the screen only
 * fetches and renders.
 */
import { getPath } from './format.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const keys = (v: unknown) => (isObj(v) ? Object.keys(v) : []);
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export interface RouteRow {
  prefix: string;
  entry: string;
  protocol: string;
  distance?: number;
  metric?: number;
  selected: boolean;
  installed: boolean;
  failed: boolean;
  flags: string;
  uptime?: string;
  nexthopGroup?: number;
  via: string;
}

/** `/vrf/{v}/router/rib/{afi}/route` + `/router/nexthop/rib` → one row per route entry. */
export function parseRoutes(routes: unknown, nexthops: unknown): RouteRow[] {
  return Object.entries(isObj(routes) ? routes : {}).flatMap(([prefix, r]) =>
    Object.entries((getPath(r, 'route-entry') as Obj | undefined) ?? {}).map(([entry, e]) => {
      const flags = keys(getPath(e, 'flags'));
      const nhg = num(getPath(e, 'nexthop-group-id'));
      const resolved = nhg === undefined ? undefined : getPath(nexthops, `${nhg}/resolved-via`);
      const viaEntries = Object.values((getPath(e, 'via-entry') as Obj | undefined) ?? {});
      const via =
        keys(resolved).join(', ') ||
        viaEntries
          .map((v) => [str(getPath(v, 'via')), str(getPath(v, 'interface'))].filter(Boolean).join(' '))
          .filter(Boolean)
          .join(', ');
      return {
        prefix,
        entry,
        protocol: str(getPath(e, 'protocol')) ?? '—',
        distance: num(getPath(e, 'distance')),
        metric: num(getPath(e, 'metric')),
        selected: flags.includes('selected'),
        installed: flags.includes('installed'),
        failed: flags.includes('failed'),
        flags: str(getPath(e, 'flags-string')) ?? '',
        uptime: str(getPath(e, 'uptime')),
        nexthopGroup: nhg,
        via: via || '—',
      };
    }),
  );
}

/** Parsed address: family + integer value (BigInt for IPv6). */
export function parseIp(s: string): { v: 4 | 6; n: bigint } | null {
  const t = s.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(t)) {
    const parts = t.split('.').map(Number);
    if (parts.some((p) => p > 255)) return null;
    return { v: 4, n: parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n) };
  }
  if (!t.includes(':') || !/^[0-9a-f:]+$/i.test(t)) return null;
  const halves = t.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<string>(Math.max(0, fill)).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some((g) => g.length === 0 || g.length > 4)) return null;
  return { v: 6, n: groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g, 16)), 0n) };
}

/** Whether `ip` falls inside `cidr` (same family only). */
export function cidrContains(cidr: string, ip: string): boolean {
  const [base = '', lenText] = cidr.split('/');
  const net = parseIp(base);
  const addr = parseIp(ip);
  if (!net || !addr || net.v !== addr.v) return false;
  const bits = net.v === 4 ? 32 : 128;
  const len = lenText === undefined ? bits : Number(lenText);
  if (!Number.isInteger(len) || len < 0 || len > bits) return false;
  const shift = BigInt(bits - len);
  return net.n >> shift === addr.n >> shift;
}

/** The most specific prefix holding `ip` (what the RIB would pick), if any. */
export function longestMatch(ip: string, prefixes: string[]): string | undefined {
  let best: string | undefined;
  let bestLen = -1;
  for (const p of prefixes) {
    if (!cidrContains(p, ip)) continue;
    const len = Number(p.split('/')[1] ?? (p.includes(':') ? 128 : 32));
    if (len > bestLen) {
      best = p;
      bestLen = len;
    }
  }
  return best;
}

export interface NeighborRow {
  iface: string;
  family: 'ipv4' | 'ipv6';
  ip: string;
  mac: string;
  state: string;
  router: boolean;
}

/** Per-interface `/ip/neighbor` reads (collect) → ARP + ND rows. */
export function parseNeighbors(byIface: Record<string, unknown>): NeighborRow[] {
  return Object.entries(byIface).flatMap(([iface, n]) =>
    (['ipv4', 'ipv6'] as const).flatMap((family) =>
      Object.entries((getPath(n, family) as Obj | undefined) ?? {}).map(([ip, o]) => ({
        iface,
        family,
        ip,
        mac: str(getPath(o, 'lladdr')) ?? '—',
        state: keys(getPath(o, 'state'))[0] ?? str(getPath(o, 'state')) ?? '—',
        router: keys(getPath(o, 'flag')).includes('is-router'),
      })),
    ),
  );
}

export interface MacRow {
  domain: string;
  mac: string;
  vlan?: number;
  iface: string;
  type: string;
  age?: number;
  remote: string;
}

/** Per-domain `/mac-table` reads (collect) → one row per learned/static entry. */
export function parseMacs(byDomain: Record<string, unknown>): MacRow[] {
  return Object.entries(byDomain).flatMap(([domain, table]) =>
    Object.values(isObj(table) ? table : {})
      .filter((e) => str(getPath(e, 'mac')))
      .map((e) => ({
        domain,
        mac: str(getPath(e, 'mac')) ?? '',
        vlan: num(getPath(e, 'vlan')),
        iface: str(getPath(e, 'interface')) ?? '—',
        type: str(getPath(e, 'entry-type')) ?? 'dynamic',
        age: num(getPath(e, 'age')),
        remote: str(getPath(e, 'remote-dst')) ?? '',
      })),
  );
}

export interface LldpRow {
  iface: string;
  id: string;
  system: string;
  port: string;
  mgmt: string;
}

const firstStr = (o: unknown, ...paths: string[]) => {
  for (const p of paths) {
    const v = str(getPath(o, p));
    if (v) return v;
  }
  return undefined;
};

/** Per-interface `/lldp/neighbor` reads (collect) → who is cabled where. */
export function parseLldp(byIface: Record<string, unknown>): LldpRow[] {
  return Object.entries(byIface).flatMap(([iface, nbrs]) =>
    Object.entries(isObj(nbrs) ? nbrs : {}).map(([id, o]) => ({
      iface,
      id,
      system: firstStr(o, 'chassis/system-name', 'chassis/chassis-id') ?? id,
      port: firstStr(o, 'port/name', 'port/description', 'port/port-id') ?? '—',
      mgmt:
        [
          ...keys(getPath(o, 'chassis/management-address-ipv4')),
          ...keys(getPath(o, 'chassis/management-address-ipv6')),
        ].join(', ') || '—',
    })),
  );
}

export interface BgpRow {
  vrf: string;
  peer: string;
  state: string;
  established: boolean;
  remoteAs: string;
  hostname: string;
  uptime?: number;
  rx?: number;
  tx?: number;
  lastReset: string;
}

/** Per-VRF `/router/bgp/neighbor` reads (collect) → session state per peer. */
export function parseBgp(byVrf: Record<string, unknown>): BgpRow[] {
  return Object.entries(byVrf).flatMap(([vrf, peers]) =>
    Object.entries(isObj(peers) ? peers : {}).map(([peer, o]) => {
      const families = Object.values((getPath(o, 'address-family') as Obj | undefined) ?? {});
      const sum = (k: string) => {
        const vals = families.map((f) => num(getPath(f, k))).filter((n): n is number => n !== undefined);
        return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : undefined;
      };
      const state = str(getPath(o, 'state')) ?? 'unknown';
      return {
        vrf,
        peer,
        state,
        established: state.toLowerCase() === 'established',
        remoteAs: str(getPath(o, 'remote-as')) ?? '—',
        hostname: str(getPath(o, 'remote-hostname')) ?? '',
        uptime: num(getPath(o, 'uptime')),
        rx: sum('rx-prefix'),
        tx: sum('tx-prefix'),
        lastReset: str(getPath(o, 'last-reset-reason')) ?? '',
      };
    }),
  );
}
