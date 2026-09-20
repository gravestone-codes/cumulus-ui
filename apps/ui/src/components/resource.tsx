/**
 * Generic resource screens (Phase 2): ViewSwitcher, ResourceList.
 * Lists are dumb — collection path + injected columns in, rows out.
 * View names come from /api/v1/spec/manifest (decision 10), never constants.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Alert, LineDropdown } from './ui.js';
import { DataTable } from './DataTable.js';
import type { TableColumns } from './DataTable.js';

/* ViewSwitcher: the manifest's view names for a path template, as a dropdown. */
export function ViewSwitcher({
  pathTemplate,
  value,
  onChange,
}: {
  pathTemplate: string;
  value?: string;
  onChange: (view?: string) => void;
}) {
  const manifest = useQuery({ queryKey: ['manifest'], queryFn: () => api.manifest(), staleTime: 300_000 });
  const views = manifest.data?.views[pathTemplate] ?? [];
  if (views.length === 0) return null;
  return (
    <LineDropdown
      label="View"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      options={[{ value: '', label: 'Default' }, ...views.map((v) => ({ value: v, label: v }))]}
    />
  );
}

/* ResourceList: collection read through the query proxy + DataTable. */
export function ResourceList<T extends object>({
  switchId,
  path,
  pathTemplate,
  title,
  columns,
  rowId,
  onSelect,
}: {
  switchId: string;
  path: string;
  pathTemplate: string;
  title: string;
  columns: TableColumns<T>;
  rowId: (row: T) => string;
  onSelect?: (id: string) => void;
}) {
  const [view, setView] = useState<string | undefined>(undefined);
  const list = useQuery({
    queryKey: ['resource', switchId, path, view],
    queryFn: () => api.query<Record<string, T>>(switchId, path, view ? { view } : undefined),
  });
  const rows = list.data ? Object.entries(list.data.data).map(([id, row]) => ({ ...row, __id: id })) : [];
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{title}</h1>
        <span style={{ flex: 1 }} />
        <span style={{ minWidth: 180 }}>
          <ViewSwitcher pathTemplate={pathTemplate} value={view} onChange={setView} />
        </span>
      </div>
      {list.isError && <Alert tone="fail">Read failed: {list.error.message}</Alert>}
      <DataTable
        columns={columns}
        rows={rows as T[]}
        loading={list.isPending}
        onRowClick={onSelect ? (row) => onSelect(rowId(row)) : undefined}
      />
      {list.data?.cached && (
        <p style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 8 }}>
          Served from cache (switch unreachable). Checked {list.data.checked_at}.
        </p>
      )}
    </section>
  );
}
