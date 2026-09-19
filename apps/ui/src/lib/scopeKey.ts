/** TanStack Query key for one NVUE read. Shape mirrors roadmap §4: (switch, path, rev, view). */
export interface NvueScope {
  /** Switch identity (inventory id). Group reads aggregate client-side; the key stays per-switch. */
  switchId: string;
}

export type NvueRev = string;

/** Stable, serializable query key. `rev` defaults to live operational state. */
export function nvueKey(scope: NvueScope, path: string, rev: NvueRev = 'operational', view?: string) {
  return ['nvue', scope.switchId, path, rev, view ?? null] as const;
}
