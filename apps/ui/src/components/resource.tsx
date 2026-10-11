/**
 * Generic resource screens (Phase 2): ViewSwitcher, ResourceList.
 * Lists are dumb — collection path + injected columns in, rows out, or
 * schema-driven (schemaPath): columns and the `?include` field set come
 * from the response schema, with domain render overrides as adapters.
 * View names come from /api/v1/spec/manifest (decision 10), never constants.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.js';
import { displayValue, getPath } from '../lib/format.js';
import { toIncludePatterns, useSchemaFields, useSchemaLeaves } from '../lib/schema.js';
import { Alert, Button, LineDropdown, ReconnectModal, Spinner } from './ui.js';
import { DataTable } from './DataTable.js';
import type { GridColumn } from './DataTable.js';
import type { RowMenuItem } from './ui.js';
import { FieldPicker } from './FieldPicker.js';

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
      onChange={(v) => onChange(v || undefined)}
      options={[{ value: '', label: 'Default' }, ...views.map((v) => ({ value: v, label: v }))]}
    />
  );
}

/* ResourceDetail: one object's live fields as a definition list. Field
   choice is presentation (per-slice, from the API reference leaf schemas);
   every value comes from the query proxy. */
export function ResourceDetail({
  switchId,
  path,
  fields,
}: {
  switchId: string;
  path: string;
  fields: Array<{ label: string; value: (obj: Record<string, unknown>) => string }>;
}) {
  const detail = useQuery({
    queryKey: ['resource-obj', switchId, path],
    queryFn: () => api.query<Record<string, unknown>>(switchId, path),
    retry: (count, err) => (err instanceof ApiError ? err.status >= 500 && count < 2 : count < 2),
    staleTime: 30_000,
  });
  if (detail.isPending) return <Spinner label="Loading details" />;
  if (detail.isError) {
    return <ReadError switchId={switchId} message={detail.error.message} onFixed={() => detail.refetch()} />;
  }
  const obj = detail.data?.data ?? {};
  return <ValueGrid items={fields.map((f) => ({ label: f.label, value: f.value(obj) }))} />;
}

/* ValueGrid: labelled values as an airy tile grid — the one config layout
   for detail pages (switch and group alike). Values may be rich (mixed
   markers, locks); labels stay uppercase micro-type. */
export function ValueGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl
      style={{
        margin: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '28px 32px',
      }}
    >
      {items.map((f) => (
        <div key={f.label} style={{ minWidth: 0 }}>
          <dt
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--color-muted)',
              marginBottom: 6,
            }}
          >
            {f.label}
          </dt>
          <dd style={{ margin: 0, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ResourceList<T extends object>({
  switchId,
  path,
  pathTemplate,
  title,
  columns,
  rowId,
  onSelect,
  storageKey,
  rowMenu,
  rev,
  actions,
  schema,
  defaultFields,
  labels,
  render,
}: {
  switchId: string;
  path: string;
  pathTemplate: string;
  title: string;
  columns: GridColumn<T>[];
  rowId: (row: T) => string;
  onSelect?: (id: string) => void;
  storageKey: string;
  rowMenu?: (row: T) => RowMenuItem[];
  rev?: string;
  /** Header actions (e.g. New interface), right of the title. */
  actions?: ReactNode;
  /**
   * Schema-driven columns (roadmap 2.1/R7): the item template whose PATCH
   * body enumerates the pickable leaves (e.g. `/interface/{interface-id}`).
   * Columns and the `?include` set come from the schema; `columns` stay as
   * the leading adapter extras (identity, computed badges).
   */
  schema?: boolean;
  /** Default picked leaf paths (persisted per table once the picker is touched). */
  defaultFields?: string[];
  /** Presentation label overrides by leaf path. */
  labels?: Record<string, string>;
  /** Adapter render overrides by leaf path (e.g. state badges). */
  render?: Record<string, (row: T) => ReactNode>;
}) {
  const [view, setView] = useState<string | undefined>(undefined);
  const { leaves, loading: schemaLoading } = useSchemaLeaves(schema ? pathTemplate : undefined);
  const { checked, setChecked } = useSchemaFields(storageKey, schema ? leaves : [], defaultFields ?? []);
  const include = schema && checked.length > 0 ? toIncludePatterns(path, checked) : undefined;
  const list = useQuery({
    queryKey: ['resource', switchId, path, view, rev, include],
    queryFn: () =>
      api.query<Record<string, T>>(
        switchId,
        path,
        { ...(view ? { view } : {}), ...(rev ? { rev } : {}), ...(include ? { include } : {}) },
      ),
    // 4xx is terminal (auth, gate, unknown path) — only 5xx/network retries.
    retry: (count, err) => (err instanceof ApiError ? err.status >= 500 && count < 2 : count < 2),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const rows = list.data ? Object.entries(list.data.data).map(([id, row]) => ({ ...row, __id: id })) : [];
  const byLeaf = new Map(leaves.map((l) => [l.path, l]));
  const schemaCols: GridColumn<T>[] =
    schema && checked.length > 0
      ? checked.map((leaf) => ({
          key: leaf,
          label: labels?.[leaf] ?? byLeaf.get(leaf)?.label ?? leaf,
          value: (row: T) => displayValue(getPath(row, leaf)) || '—',
          ...(render?.[leaf] ? { render: render[leaf] } : {}),
        }))
      : [];
  const cols = [...columns, ...schemaCols];
  return (
    <section style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{title}</h1>
        <span style={{ flex: 1 }} />
        {actions}
        {schema && leaves.length > 0 && (
          <FieldPicker leaves={leaves} checked={checked} defaults={defaultFields ?? []} onChange={setChecked} />
        )}
        <span style={{ minWidth: 180 }}>
          <ViewSwitcher pathTemplate={pathTemplate} value={view} onChange={setView} />
        </span>
      </div>
      {list.isError ? (
        <ReadError switchId={switchId} message={list.error.message} onFixed={() => list.refetch()} />
      ) : (
        <DataTable
          cols={cols}
          rows={rows as T[]}
          loading={list.isPending || (schema && schemaLoading)}
          storageKey={storageKey}
          onRowClick={onSelect ? (row) => onSelect(rowId(row)) : undefined}
          actions={rowMenu}
        />
      )}
      {list.data?.cached && (
        <p style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 8 }}>
          Served from cache (switch unreachable). Checked {list.data.checked_at}.
        </p>
      )}
    </section>
  );
}

/* ReadError: failed collection read. Expired/rejected switch sessions offer
   reconnect inline instead of a dead end. */
export function ReadError({
  switchId,
  message,
  onFixed,
}: {
  switchId: string;
  message: string;
  onFixed: () => void;
}) {
  const needsAuth = message.includes('expired') || message.includes('reconnect');
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Alert tone="fail">Read failed: {message}</Alert>
      {needsAuth && (
        <div>
          <Button auto variant="secondary" onClick={() => setOpen(true)}>
            Reconnect switch
          </Button>
        </div>
      )}
      <ReconnectModal switchId={switchId} open={open} onClose={() => setOpen(false)} onDone={onFixed} />
    </div>
  );
}
