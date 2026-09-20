/**
 * DataTable: the one table. Thin wrapper over TanStack Table v9 (core
 * features only — sorting/filtering arrive as feature registrations when a
 * slice needs them). Columns are injected by callers; states included.
 */
import { coreFeatures, useTable } from '@tanstack/react-table';
import type { ColumnDef, CoreFeatures } from '@tanstack/react-table';

export type TableColumns<T extends object> = Array<ColumnDef<CoreFeatures, T, unknown>>;

export function DataTable<T extends object>({
  columns,
  rows,
  loading = false,
  onRowClick,
}: {
  columns: TableColumns<T>;
  rows: T[];
  loading?: boolean;
  onRowClick?: (row: T) => void;
}) {
  const table = useTable({ features: coreFeatures, columns, data: rows });
  if (loading) return <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>Loading…</p>;
  if (rows.length === 0)
    return <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>Nothing here yet.</p>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 15 }}>
      <thead>
        {table.getHeaderGroups().map((hg) => (
          <tr key={hg.id}>
            {hg.headers.map((h) => (
              <th
                key={h.id}
                style={{
                  textAlign: 'left',
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--color-muted)',
                  padding: '8px 10px',
                  borderBottom: '1px solid var(--color-border)',
                }}
              >
                <table.FlexRender header={h} />
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((r) => (
          <tr
            key={r.id}
            onClick={onRowClick ? () => onRowClick(r.original) : undefined}
            style={onRowClick ? { cursor: 'pointer' } : undefined}
          >
            {r.getAllCells().map((c) => (
              <td key={c.id} style={{ padding: '9px 10px', borderBottom: '1px solid var(--color-border)' }}>
                <table.FlexRender cell={c} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
