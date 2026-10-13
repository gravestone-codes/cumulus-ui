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
import { Alert, Button, LineDropdown, ReconnectModal, Spinner, Tabs, type NavIcon } from './ui.js';
import { DataTable } from './DataTable.js';
import type { GridColumn } from './DataTable.js';
import type { RowMenuItem } from './ui.js';
import { PresenceBanner } from './presence.js';

/* ViewSwitcher: the manifest's view names for a collection path, as a dropdown. */
export function ViewSwitcher({
  path,
  value,
  onChange,
}: {
  /** Collection path being read (views live on collections, e.g. `/interface`). */
  path: string;
  value?: string;
  onChange: (view?: string) => void;
}) {
  const manifest = useQuery({ queryKey: ['manifest'], queryFn: () => api.manifest(), staleTime: 300_000 });
  const views = manifest.data?.views[path] ?? [];
  // No views, no slot: an empty placeholder would push header actions off the table edge.
  if (views.length === 0) return null;
  return (
    <span style={{ minWidth: 180 }}>
      <LineDropdown
        label="View"
        value={value ?? ''}
        onChange={(v) => onChange(v || undefined)}
        options={[{ value: '', label: 'Default' }, ...views.map((v) => ({ value: v, label: v }))]}
      />
    </span>
  );
}

/** Canonical store kinds (§2 identity): one object, one store; paths are lenses. */
export type DetailKind = 'interface' | 'bridge' | 'vrf' | 'generic';

/** Resolve an identity to its NVUE object path (explicit path wins — arbitrary lenses stay possible). */
export function detailPath(kind: DetailKind, id: string, explicit?: string): string {
  if (explicit) return explicit;
  switch (kind) {
    case 'interface':
      return `/interface/${id}`;
    case 'bridge':
      return `/bridge/domain/${id}`;
    case 'vrf':
      return `/vrf/${id}`;
    case 'generic':
      return id;
  }
}

/** Human noun per kind for loading/absent copy. */
const KIND_NOUN: Record<DetailKind, string> = {
  interface: 'interface',
  bridge: 'bridge domain',
  vrf: 'VRF',
  generic: 'object',
};

export interface DetailTab {
  id: string;
  label: string;
  content: ReactNode;
}

export interface DetailRead {
  members: string[];
  loading: boolean;
  error: Error | null;
  errors: Record<string, string>;
  refetch: () => void;
}

/* ResourceDetail: one object's frame — header (title, group presence,
   actions) + tab slots for widgets. Data reads stay in screens (passed as
   `read`); identity (scope, kind, id) derives path, presence and copy. */
export function ResourceDetail({
  scope,
  kind,
  id,
  path,
  tabs,
  activeTab,
  onTabChange,
  actions,
  read,
  present,
}: {
  scope: { kind: 'switch' | 'group'; id: string };
  kind: DetailKind;
  /** Object name within its store (interface name, domain id, ...). */
  id: string;
  /** Explicit object path (default: derived from kind). */
  path?: string;
  tabs: DetailTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  /** Header actions (e.g. row kebab). */
  actions?: ReactNode;
  /** Primary read driving loading/error/absent states. */
  read: DetailRead;
  /** Members holding the object (subset of read.members). */
  present: string[];
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const objectPath = detailPath(kind, id, path);
  const group = scope.kind === 'group';
  const failed = Object.keys(read.errors);
  const absent = read.members.filter((sw) => !present.includes(sw) && !failed.includes(sw));
  const active = activeTab ?? picked ?? tabs[0]?.id ?? '';
  function select(tabId: string) {
    if (onTabChange) onTabChange(tabId);
    else setPicked(tabId);
  }
  return (
    <>
      <div className="list-head" style={{ gap: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{id}</h1>
        {group && !read.loading && (
          <span
            style={{
              fontSize: 13,
              color: absent.length > 0 ? 'var(--color-warn)' : 'var(--color-muted)',
            }}
          >
            on {present.length} of {read.members.length} switch{read.members.length === 1 ? '' : 'es'}
            {absent.length > 0 && ` · absent on ${absent.join(', ')}`}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {present.length > 0 && actions}
      </div>
      {read.error ? (
        <ReadError switchId={group ? '' : scope.id} message={read.error.message} onFixed={read.refetch} />
      ) : read.loading ? (
        <Spinner label={`Loading ${KIND_NOUN[kind]}`} />
      ) : present.length === 0 ? (
        <Alert tone="warn">
          {id} does not exist on {group ? `any switch in ${scope.id}` : scope.id}.
        </Alert>
      ) : (
        <>
          <PresenceBanner members={present} path={objectPath} label={id} group={group} />
          {failed.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Alert tone="warn">
                Could not read {failed.map((sw) => `${sw} (${read.errors[sw]})`).join(', ')} — shown without
                {failed.length === 1 ? ' it' : ' them'}.
              </Alert>
            </div>
          )}
          {tabs.length > 1 && (
            <Tabs tabs={tabs.map((t) => ({ id: t.id, label: t.label }))} active={active} onChange={select} />
          )}
          {tabs.find((t) => t.id === active)?.content}
        </>
      )}
    </>
  );
}

/* ValueGrid: labelled values as an airy tile grid — the one config layout
   for detail pages (switch and group alike). Values may be rich (mixed
   markers, locks); labels stay uppercase micro-type. `muted` dims options
   whose feature toggle is off. */
export function ValueGrid({ items }: { items: Array<{ label: string; value: ReactNode; muted?: boolean }> }) {
  return (
    <dl
      style={{
        margin: 0,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))',
        gap: '28px 32px',
      }}
    >
      {items.map((f) => (
        <div key={f.label} className={f.muted ? 'gated' : undefined} style={{ minWidth: 0 }}>
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
  emptyIcon,
  schema,
  defaultFields,
  labels,
  render,
  schemaMethod,
  alwaysInclude,
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
  /** Centered empty-state icon (icon + text, centered both axes). */
  emptyIcon?: NavIcon;
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
  /** Schema operation for the field catalog (default PATCH; GET for read-only collections). */
  schemaMethod?: string;
  /** Leaves adapter columns read (e.g. link state), fetched alongside the picked fields. */
  alwaysInclude?: string[];
}) {
  const [view, setView] = useState<string | undefined>(undefined);
  const { leaves, loading: schemaLoading } = useSchemaLeaves(schema ? pathTemplate : undefined, schemaMethod);
  const { checked, setChecked } = useSchemaFields(storageKey, schema ? leaves : [], defaultFields ?? []);
  // NVUE rejects `include` alongside `view`: a view is its own field set.
  const include =
    schema && checked.length > 0 && !view
      ? toIncludePatterns(path, [...checked, ...(alwaysInclude ?? [])])
      : undefined;
  const list = useQuery({
    queryKey: ['resource', switchId, path, view, rev, include],
    queryFn: () =>
      api.query<Record<string, T>>(switchId, path, {
        ...(view ? { view } : {}),
        ...(rev ? { rev } : {}),
        ...(include ? { include } : {}),
      }),
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
      <div className="list-head" style={{ gap: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{title}</h1>
        <span style={{ flex: 1 }} />
        {actions}
        <ViewSwitcher path={path} value={view} onChange={setView} />
      </div>
      {list.isError ? (
        <ReadError switchId={switchId} message={list.error.message} onFixed={() => list.refetch()} />
      ) : (
        <DataTable
          cols={cols}
          rows={rows as T[]}
          loading={list.isPending || (schema && schemaLoading)}
          emptyIcon={emptyIcon}
          storageKey={storageKey}
          onRowClick={onSelect ? (row) => onSelect(rowId(row)) : undefined}
          actions={rowMenu}
          fields={
            schema && leaves.length > 0
              ? { leaves, checked, defaults: defaultFields ?? [], onChange: setChecked }
              : undefined
          }
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
