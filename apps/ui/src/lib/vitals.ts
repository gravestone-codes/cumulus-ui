/**
 * Switch vitals for dashboards (roadmap 3H.1): system, CPU, memory, health,
 * environment and interface counters, read live per switch and shared by
 * every widget through one query key each. Parsers are pure so the NVUE
 * shapes stay pinned by tests; missing pieces read as undefined, never 0.
 */
import { useQueries } from '@tanstack/react-query';
import { api } from './api.js';
import { getPath, ifaceState } from './format.js';

type Obj = Record<string, unknown>;

export interface HealthIssue {
  name: string;
  text: string;
  ok: boolean;
}

export interface Sensor {
  name: string;
  type: string;
  state: string;
  ok: boolean;
  current?: number;
  max?: number;
  crit?: number;
}

/** Byte counts from `/system/memory` (Physical or Swap), as NVUE reports them. */
export interface MemoryUse {
  total?: number;
  used?: number;
  free?: number;
  /** Buffers + page cache (Physical only): reclaimable, counted apart from used. */
  cache?: number;
}

export interface Vitals {
  hostname?: string;
  version?: string;
  build?: string;
  kernel?: string;
  baseOs?: string;
  uptime?: number;
  cpu?: number;
  cpuCores?: number;
  cpuModel?: string;
  memory?: number;
  memoryText?: string;
  physical: MemoryUse;
  swap: MemoryUse;
  health?: { ok: boolean; status: string; issues: HealthIssue[] };
  sensors: Sensor[];
}

export interface PortRow {
  sw: string;
  name: string;
  type: string;
  state: 'up' | 'down' | 'admin-down' | 'unknown';
  inBytes: number;
  outBytes: number;
  errors: number;
  drops: number;
  /** Carrier transitions: link flaps since the counters were last cleared. */
  flaps: number;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const OK_STATES = new Set(['ok', 'green', 'present', 'up', 'enabled']);
/** Service lines in /system/health read healthy when running or merely parked. */
const healthyIssue = (text: string) => /^(ok|active|running)/i.test(text.trim());

/** /system + /system/cpu + /system/memory + /system/health + /platform/environment(/temperature). */
export function parseVitals(parts: {
  system?: unknown;
  cpu?: unknown;
  memory?: unknown;
  health?: unknown;
  env?: unknown;
  temps?: unknown;
}): Vitals {
  const sys = (parts.system ?? {}) as Obj;
  const health = parts.health as Obj | undefined;
  const issues = Object.entries((health?.['issues'] as Obj | undefined) ?? {}).map(([name, v]) => {
    const text = String(getPath(v, 'issue') ?? '');
    return { name, text, ok: healthyIssue(text) };
  });
  const status = typeof health?.['status'] === 'string' ? (health['status'] as string) : undefined;
  const temps = (parts.temps ?? {}) as Obj;
  const sensors = Object.entries((parts.env ?? {}) as Obj).map(([name, v]): Sensor => {
    const state = String(getPath(v, 'state') ?? '');
    const t = temps[name];
    return {
      name,
      type: String(getPath(v, 'type') ?? ''),
      state,
      ok: OK_STATES.has(state.toLowerCase()),
      current: num(getPath(t, 'current')),
      max: num(getPath(t, 'max')),
      crit: num(getPath(t, 'crit')),
    };
  });
  const text = (o: unknown, path: string) => {
    const v = getPath(o, path);
    return typeof v === 'string' && v !== '' && v !== 'N/A' ? v : undefined;
  };
  const mem = (kind: 'Physical' | 'Swap'): MemoryUse => {
    const m = (k: string) => num(getPath(parts.memory, `${kind}/${k}`));
    const buffer = m('buffer');
    const cache = m('cache');
    return {
      total: m('total'),
      used: m('used'),
      free: m('free'),
      cache: buffer === undefined && cache === undefined ? undefined : (buffer ?? 0) + (cache ?? 0),
    };
  };
  return {
    hostname: text(sys, 'hostname'),
    version: text(sys, 'version/product-release'),
    build: text(sys, 'version/image/build-id'),
    kernel: text(sys, 'version/kernel'),
    baseOs: text(sys, 'version/base-os'),
    uptime: num(sys['uptime']),
    cpu: num(getPath(parts.cpu, 'utilization')),
    cpuCores: num(getPath(parts.cpu, 'core-count')),
    cpuModel: text(parts.cpu, 'model'),
    memory: num(getPath(parts.memory, 'Physical/utilization')),
    memoryText: typeof sys['system-memory'] === 'string' ? sys['system-memory'] : undefined,
    physical: mem('Physical'),
    swap: mem('Swap'),
    health: status ? { ok: status.toLowerCase() === 'ok', status, issues } : undefined,
    sensors,
  };
}

/** Interfaces worth counting as ports: loopbacks and VRF devices are plumbing. */
const PLUMBING = new Set(['loopback', 'vrf']);

/** /interface (operational) → one row per port with state and cumulative counters. */
export function parsePorts(sw: string, ifaces: Record<string, unknown> | undefined): PortRow[] {
  return Object.entries(ifaces ?? {}).flatMap(([name, v]) => {
    const type = String(getPath(v, 'type') ?? '');
    if (PLUMBING.has(type)) return [];
    const s = ifaceState(v);
    const admin = getPath(v, 'link/admin-status');
    const state: PortRow['state'] =
      admin === 'down' ? 'admin-down' : s === 'up' ? 'up' : s === 'down' ? 'down' : 'unknown';
    const st = (k: string) => num(getPath(v, `link/stats/${k}`)) ?? 0;
    return [
      {
        sw,
        name,
        type,
        state,
        inBytes: st('in-bytes'),
        outBytes: st('out-bytes'),
        errors: st('in-errors') + st('out-errors'),
        drops: st('in-drops') + st('out-drops'),
        flaps: st('carrier-transitions'),
      },
    ];
  });
}

/** Seconds → "7d 3h" / "4h 12m" / "9m". */
export function uptimeText(sec: number | undefined): string {
  if (sec === undefined) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const settle = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data).catch(() => undefined);

/** Interface read shared with the Interfaces screen and switch home (same key, one fetch). */
export function ifaceQuery(switchId: string) {
  return {
    queryKey: ['resource', switchId, '/interface', undefined, 'operational'],
    queryFn: () => api.query<Record<string, unknown>>(switchId, '/interface', { rev: 'operational' }),
    retry: false,
    staleTime: 30_000,
  } as const;
}

/** Vitals per switch id; each switch is one cached query shared by every widget. */
export function useVitals(ids: string[]) {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['vitals', id],
      queryFn: async () => {
        const op = { rev: 'operational' } as const;
        const [system, cpu, memory, health, env, temps] = await Promise.all([
          settle(api.query(id, '/system', op)),
          settle(api.query(id, '/system/cpu', op)),
          settle(api.query(id, '/system/memory', op)),
          settle(api.query(id, '/system/health', op)),
          settle(api.query(id, '/platform/environment', op)),
          settle(api.query(id, '/platform/environment/temperature', op)),
        ]);
        if (system === undefined && cpu === undefined && memory === undefined) {
          throw new Error('unreachable');
        }
        return parseVitals({ system, cpu, memory, health, env, temps });
      },
      retry: false,
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  return {
    loading: results.some((r) => r.isPending),
    byId: Object.fromEntries(ids.map((id, i) => [id, results[i]?.data])) as Record<
      string,
      Vitals | undefined
    >,
    failed: ids.filter((_, i) => results[i]?.isError),
  };
}

/** Port rows across switches (live counters, shared interface cache). */
export function usePorts(ids: string[]) {
  const results = useQueries({ queries: ids.map((id) => ifaceQuery(id)) });
  return {
    loading: results.some((r) => r.isPending),
    rows: ids.flatMap((id, i) => parsePorts(id, results[i]?.data?.data)),
    failed: ids.filter((_, i) => results[i]?.isError),
  };
}
