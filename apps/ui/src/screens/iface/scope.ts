/**
 * Interface scope: one switch or a group of them. Every interface screen
 * reads through these hooks, so a group is "the same screen over N
 * members": per-switch objects in, merged views out (lib/merge). Reads go
 * through the backend (single proxy or group fan-out), never to switches.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';
import { api, ApiError, type MemberResult } from '../../lib/api.js';

export type Scope = { kind: 'switch'; id: string } | { kind: 'group'; id: string };

/** Per-switch objects for one path; `undefined` = the member lacks it (404). */
export interface PerSwitch<T> {
  members: string[];
  objects: Record<string, T | undefined>;
  /** Members whose read failed for reasons other than absence (auth, reachability). */
  errors: Record<string, string>;
  loading: boolean;
  /** Whole-read failure (single switch: the switch's own error; group: route refused). */
  error: Error | null;
  refetch: () => void;
}

/** Route base for a scope: `/switches/leaf01` or `/groups/GG` (raw ids, matching lib/nav). */
export const scopeBase = (s: Scope) => `/${s.kind === 'switch' ? 'switches' : 'groups'}/${s.id}`;

function fromMembers<T>(results: MemberResult<T>[]): Pick<PerSwitch<T>, 'members' | 'objects' | 'errors'> {
  const objects: Record<string, T | undefined> = {};
  const errors: Record<string, string> = {};
  for (const r of results) {
    if (r.ok) objects[r.switchId] = r.data;
    else if (r.status !== 404) errors[r.switchId] = r.error ?? 'read failed';
  }
  return { members: results.map((r) => r.switchId), objects, errors };
}

/**
 * Read one NVUE path across the scope. `rev: 'applied'` reads configuration
 * (config-only subtrees exist there alone); default reads operational state.
 */
export function usePerSwitch<T = Record<string, unknown>>(
  scope: Scope,
  path: string,
  opts: { rev?: string; refetchMs?: number; enabled?: boolean } = {},
): PerSwitch<T> {
  const q = useQuery({
    queryKey: ['scope-read', scope.kind, scope.id, path, opts.rev ?? 'operational'],
    queryFn: async () => {
      if (scope.kind === 'group') {
        const res = await api.groupQuery<T>(scope.id, path, opts.rev ? { rev: opts.rev } : undefined);
        return fromMembers(res.results);
      }
      try {
        const res = await api.query<T>(scope.id, path, opts.rev ? { rev: opts.rev } : undefined);
        return { members: [scope.id], objects: { [scope.id]: res.data }, errors: {} };
      } catch (err) {
        // Absence is an answer for one switch too (interface gone, subtree unset).
        if (err instanceof ApiError && err.status === 404) {
          return { members: [scope.id], objects: { [scope.id]: undefined }, errors: {} };
        }
        throw err;
      }
    },
    retry: (count, err) => (err instanceof ApiError ? err.status >= 500 && count < 2 : count < 2),
    staleTime: 30_000,
    refetchInterval: opts.refetchMs,
    enabled: opts.enabled ?? true,
  });
  return {
    members: q.data?.members ?? (scope.kind === 'switch' ? [scope.id] : []),
    objects: q.data?.objects ?? {},
    errors: q.data?.errors ?? {},
    loading: q.isPending,
    error: q.error,
    refetch: () => void q.refetch(),
  };
}

/** Query-key prefix for every scope read; invalidate it after applies. */
export const SCOPE_READ_KEY = ['scope-read'] as const;

/** After a write: drop every cached interface read (scope reads + the generic resource lists). */
export function refreshInterfaces(client: QueryClient): void {
  for (const key of [SCOPE_READ_KEY, ['resource'], ['resource-obj']]) {
    void client.invalidateQueries({ queryKey: key });
  }
}
