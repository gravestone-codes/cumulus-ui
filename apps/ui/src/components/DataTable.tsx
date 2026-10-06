/**
 * DataTable, GRG contract: global search bar, sortable headers, per-column
 * funnel filters, column show/hide + arrow reorder (persisted), kebab row
 * actions, pagination with persisted page size (10–200). Client-side over
 * the fetched rows — collections here are small; the server stays dumb.
 */
import { useMemo, useState } from 'react';
import { useColumnPrefs } from '../lib/columnPrefs.js';
import { PAGE_SIZES, usePagination, type PageSize } from '../lib/pagination.js';
import ColumnFilter, { filterActive, matchesFilter, type ColumnFilterState } from './ColumnFilter.js';
import ColumnsButton from './ColumnsButton.js';
import { RowMenu, SelectMenu, Spinner, type RowMenuItem } from './ui.js';

export interface GridColumn<T> {
  key: string;
  label: string;
  always?: boolean;
  sortable?: boolean;
  value: (row: T) => string;
  render?: (row: T) => React.ReactNode;
}

type Sort = { key: string; dir: 'asc' | 'desc' } | null;

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--color-muted)',
  padding: '12px 16px',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderTop: '1px solid var(--color-border)',
  fontSize: 14,
};

export function DataTable<T extends object>({
  cols,
  rows,
  loading = false,
  empty,
  storageKey,
  onRowClick,
  actions,
  actionsLabel = 'Row actions',
}: {
  cols: GridColumn<T>[];
  rows: T[];
  loading?: boolean;
  empty?: React.ReactNode;
  storageKey: string;
  onRowClick?: (row: T) => void;
  actions?: (row: T) => RowMenuItem[];
  actionsLabel?: string;
}) {
  const catalog = useMemo(() => cols.map((c) => ({ key: c.key, label: c.label, always: c.always })), [cols]);
  const byKey = useMemo(() => new Map(cols.map((c) => [c.key, c])), [cols]);
  const { prefs, visibleKeys, toggle, move, reset } = useColumnPrefs(`${storageKey}.columns`, catalog);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>(() => {
    const first = cols.find((c) => c.sortable !== false);
    return first ? { key: first.key, dir: 'asc' } : null;
  });
  const [filters, setFilters] = useState<Partial<Record<string, ColumnFilterState>>>({});

  function onSort(key: string) {
    setSort((s) => {
      if (s?.key !== key) return { key, dir: 'asc' };
      if (s.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  const distinctValues = (key: string): string[] => {
    const col = byKey.get(key);
    if (!col) return [];
    return Array.from(new Set(rows.map((r) => col.value(r)).filter((v) => v !== ''))).sort();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter((r) => {
      for (const [key, f] of Object.entries(filters)) {
        if (!f || !filterActive(f)) continue;
        const col = byKey.get(key);
        if (col && !matchesFilter(col.value(r), f)) return false;
      }
      if (!q) return true;
      return visibleKeys.some((k) => byKey.get(k)?.value(r).toLowerCase().includes(q));
    });
    if (!sort) return out;
    const col = byKey.get(sort.key);
    if (!col) return out;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...out].sort(
      (a, b) => col.value(a).localeCompare(col.value(b), undefined, { numeric: true }) * dir,
    );
  }, [rows, filters, search, sort, byKey, visibleKeys]);

  const pagination = usePagination(filtered, `${storageKey}.page`);

  if (loading) return <Spinner label="Loading table" />;
  if (rows.length === 0) {
    return <>{empty ?? <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>Nothing here yet.</p>}</>;
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span className="lf" style={{ display: 'flex', flex: 1, maxWidth: 320 }}>
          <input
            aria-label="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
          />
        </span>
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid var(--color-border)', borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}>
          <thead>
            <tr>
              {visibleKeys.map((key) => {
                const col = byKey.get(key)!;
                const sortable = col.sortable !== false;
                return (
                  <th key={key} style={thStyle}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => onSort(key)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            font: 'inherit',
                            color: 'inherit',
                            padding: 0,
                          }}
                        >
                          {col.label}
                          <span
                            style={{ display: 'inline-block', width: 10, textAlign: 'center', fontSize: 9 }}
                          >
                            {sort?.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                          </span>
                        </button>
                      ) : (
                        col.label
                      )}
                      <ColumnFilter
                        label={col.label}
                        filter={filters[key]}
                        distinct={distinctValues(key)}
                        onChange={(f) => setFilters((p) => ({ ...p, [key]: f }))}
                      />
                    </span>
                  </th>
                );
              })}
              {actions && (
                <th style={{ ...thStyle, textAlign: 'right', width: 80 }}>
                  <ColumnsButton
                    catalog={catalog}
                    prefs={prefs}
                    onToggle={toggle}
                    onMove={move}
                    onReset={reset}
                  />
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {pagination.pageItems.length === 0 && (
              <tr>
                <td
                  colSpan={visibleKeys.length + (actions ? 1 : 0)}
                  style={{
                    ...tdStyle,
                    textAlign: 'center',
                    padding: '48px 16px',
                    color: 'var(--color-muted)',
                  }}
                >
                  No rows match the current filters.
                </td>
              </tr>
            )}
            {pagination.pageItems.map((row, i) => (
              <tr
                key={i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {visibleKeys.map((key) => {
                  const col = byKey.get(key)!;
                  return (
                    <td key={key} style={tdStyle}>
                      {col.render ? col.render(row) : col.value(row)}
                    </td>
                  );
                })}
                {actions && (
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <RowMenu label={actionsLabel} items={actions(row)} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {pagination.total > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              borderTop: '1px solid var(--color-border)',
              padding: '10px 16px',
              fontSize: 13,
              color: 'var(--color-muted)',
            }}
          >
            <span>
              <strong style={{ color: 'var(--color-text)', fontWeight: 700 }}>
                {pagination.start + 1}–{Math.min(pagination.start + pagination.pageSize, pagination.total)}
              </strong>{' '}
              of {pagination.total}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12 }}>Rows per page</span>
                <SelectMenu
                  label="Rows per page"
                  value={String(pagination.pageSize)}
                  options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
                  onChange={(v) => pagination.setPageSize(Number(v) as PageSize)}
                  width={120}
                />
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => pagination.setPage(pagination.page - 1)}
                  aria-label="Previous page"
                  style={pageBtn(pagination.page <= 1)}
                >
                  ‹
                </button>
                <span style={{ minWidth: 56, textAlign: 'center', fontSize: 12 }}>
                  {pagination.page} / {pagination.totalPages}
                </span>
                <button
                  type="button"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => pagination.setPage(pagination.page + 1)}
                  aria-label="Next page"
                  style={pageBtn(pagination.page >= pagination.totalPages)}
                >
                  ›
                </button>
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function pageBtn(disabled: boolean): React.CSSProperties {
  return {
    display: 'grid',
    placeItems: 'center',
    width: 28,
    height: 28,
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    color: 'var(--color-muted)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.3 : 1,
    font: 'inherit',
    fontSize: 16,
  };
}
