/** Relative time: just now, 5m ago, 3h ago, or the date. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Dotted-path getter for NVUE's nested objects (`link/state`,
 * `link/stats/in-pkts`). Returns undefined when anything along the path is
 * missing — callers decide the fallback, never `String({...})` accidents.
 */
export function getPath(row: unknown, path: string): unknown {
  let node: unknown = row;
  for (const seg of path.split('/')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

/** First defined, non-empty value among dotted paths. */
export function firstDefined(row: unknown, ...paths: string[]): string | undefined {
  for (const p of paths) {
    const v = getPath(row, p);
    if (typeof v === 'string' && v !== '') return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/**
 * Interface state: operational link state, falling back to oper-status.
 * `unknown` stays visible (honest) — except loopback, which is up by
 * definition and whose oper-status is always `unknown`.
 */
export function ifaceState(row: unknown): string | undefined {
  const s = firstDefined(row, 'link/state', 'link/oper-status');
  if (s && s !== 'unknown') return s;
  if (getPath(row, 'type') === 'loopback') return 'up';
  return s;
}
