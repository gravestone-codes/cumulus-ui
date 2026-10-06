/**
 * Pure table pipeline (search → column filters → sort → paginate), shared by
 * every DataTable. Extracted for unit tests: header clicks, funnels and the
 * pager are thin wrappers over these.
 */

export interface TableColumn<T> {
  key: string;
  value: (row: T) => string;
}

export type TableSort = { key: string; dir: 'asc' | 'desc' } | null;

export function cycleSort(current: TableSort, key: string): TableSort {
  if (current?.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

export function applySearchFilterSort<T>(
  rows: T[],
  cols: Map<string, TableColumn<T>>,
  visibleKeys: string[],
  search: string,
  filters: Partial<Record<string, ColumnFilterState>>,
  sort: TableSort,
): T[] {
  const q = search.trim().toLowerCase();
  const out = rows.filter((r) => {
    for (const [key, f] of Object.entries(filters)) {
      if (!f || !filterActive(f)) continue;
      const col = cols.get(key);
      if (col && !matchesFilter(col.value(r), f)) return false;
    }
    if (!q) return true;
    return visibleKeys.some((k) => cols.get(k)?.value(r).toLowerCase().includes(q));
  });
  if (!sort) return out;
  const col = cols.get(sort.key);
  if (!col) return out;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...out].sort(
    (a, b) => col.value(a).localeCompare(col.value(b), undefined, { numeric: true }) * dir,
  );
}

export function paginateRows<T>(
  items: T[],
  page: number,
  pageSize: number,
): { pageItems: T[]; totalPages: number; page: number; start: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const clamped = Math.min(Math.max(1, page), totalPages);
  const start = (clamped - 1) * pageSize;
  return { pageItems: items.slice(start, start + pageSize), totalPages, page: clamped, start };
}

export type FilterOp = 'includes' | 'is' | 'isNot' | 'isOneOf';

export interface ColumnFilterState {
  op: FilterOp;
  value: string;
  values: string[];
}

export function filterActive(f: ColumnFilterState | undefined): boolean {
  if (!f) return false;
  if (f.op === 'isOneOf') return f.values.length > 0;
  return f.value.trim().length > 0;
}

export function matchesFilter(text: string, f: ColumnFilterState): boolean {
  const t = text.toLowerCase();
  if (f.op === 'isOneOf') return f.values.length === 0 || f.values.some((v) => v.toLowerCase() === t);
  const v = f.value.trim().toLowerCase();
  if (!v) return true;
  if (f.op === 'includes') return t.includes(v);
  if (f.op === 'is') return t === v;
  return t !== v;
}
