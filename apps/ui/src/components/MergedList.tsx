/**
 * MergedList: one row per object name across a scope's members (design
 * §5A). Agreeing values read plain, disagreeing ones "mixed", presence as
 * n/m; group rows expand to one row per switch. In switch scope it is a
 * plain table. Domains pass value columns; drift = absent somewhere or
 * any value column mixed.
 */
import { useState, type ReactNode } from 'react';
import { Button, ReconnectModal, Spinner, type RowMenuItem } from './ui.js';
import { ReadError } from './resource.js';
import { DataTable, type GridColumn } from './DataTable.js';
import { MixedValue } from './mixed.js';
import { mergeValues } from '../lib/merge.js';

type Obj = Record<string, unknown>;

/** One row: an object name and every member's object for it; `sw` set on per-switch sub-rows. */
export type MergedRow = { name: string; per: Record<string, Obj | undefined>; sw?: string };

/** A merged value column: one display string per member's object ('' = unset). */
export interface MergedColumn {
  key: string;
  label: string;
  get: (obj: Obj | undefined) => string;
}

/** Members holding the row's object (the one switch on a sub-row). */
export const holdersOf = (r: MergedRow, members: string[]) =>
  r.sw ? [r.sw] : members.filter((sw) => r.per[sw] !== undefined);

/** Rows for every name any member has, in natural order. */
export function mergedRows(
  members: string[],
  objects: Record<string, Record<string, Obj> | undefined>,
): MergedRow[] {
  const names = [...new Set(members.flatMap((sw) => Object.keys(objects[sw] ?? {})))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  return names.map((name) => ({
    name,
    per: Object.fromEntries(members.map((sw) => [sw, objects[sw]?.[name]])),
  }));
}

export function MergedList({
  group,
  title,
  noun,
  members,
  objects,
  errors = {},
  loading,
  error,
  refetch,
  columns,
  extra = [],
  storageKey,
  actions,
  onOpen,
  onOpenSwitch,
  rowActions,
}: {
  /** Group scope: presence column, per-switch sub-rows, drift filter. */
  group: boolean;
  /** Page heading; omitted inside a tab. */
  title?: string;
  /** Plural count noun, e.g. "interfaces". */
  noun: string;
  members: string[];
  /** Per member: the collection (name → object); undefined = member lacks it. */
  objects: Record<string, Record<string, Obj> | undefined>;
  /** Members whose read failed. */
  errors?: Record<string, string>;
  loading: boolean;
  error?: Error | null;
  refetch: () => void;
  columns: MergedColumn[];
  /** Hand-rendered columns after Present (e.g. interface state badges). */
  extra?: GridColumn<MergedRow>[];
  storageKey: string;
  /** Header actions (e.g. New interface). */
  actions?: ReactNode;
  onOpen?: (name: string) => void;
  onOpenSwitch?: (sw: string, name: string) => void;
  rowActions?: (row: MergedRow, holders: string[]) => RowMenuItem[];
}) {
  const [driftOnly, setDriftOnly] = useState(false);
  const [reconnect, setReconnect] = useState<string | null>(null);
  const rows = mergedRows(members, objects);
  const holders = (r: MergedRow) => holdersOf(r, members);
  const merged = (r: MergedRow, c: MergedColumn) =>
    mergeValues(Object.fromEntries(holders(r).map((sw) => [sw, c.get(r.per[sw])])));
  const drifts = (r: MergedRow) =>
    holders(r).length < members.length || columns.some((c) => merged(r, c).kind === 'mixed');

  const cols: GridColumn<MergedRow>[] = [
    { key: 'name', label: 'Name', always: true, value: (r) => r.sw ?? r.name },
    ...(group
      ? [
          {
            key: 'present',
            label: 'Present',
            value: (r: MergedRow) => (r.sw ? '' : `${holders(r).length}/${members.length}`),
            render: (r: MergedRow) =>
              r.sw ? null : (
                <span style={{ color: holders(r).length < members.length ? 'var(--color-warn)' : undefined }}>
                  {holders(r).length}/{members.length}
                </span>
              ),
          },
        ]
      : []),
    ...extra,
    ...columns.map((c) => ({
      key: c.key,
      label: c.label,
      value: (r: MergedRow) => {
        const m = merged(r, c);
        return m.kind === 'mixed' ? 'mixed' : m.kind === 'same' ? m.value || '—' : '—';
      },
      render: (r: MergedRow) => {
        const m = merged(r, c);
        if (m.kind === 'mixed')
          return (
            <MixedValue
              groups={m.groups}
              label={`${r.name} ${c.label}`}
              onOpen={onOpenSwitch ? (sw) => onOpenSwitch(sw, r.name) : undefined}
            />
          );
        return m.kind === 'same' && m.value !== '' ? m.value : '—';
      },
    })),
  ];

  const failed = Object.entries(errors);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        {title && <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{title}</h1>}
        {!loading && (
          <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>
            {group && `${members.length} switch${members.length === 1 ? '' : 'es'} · `}
            {rows.length} {noun}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {group && (
          <Button
            auto
            variant="secondary"
            aria-pressed={driftOnly}
            onClick={() => setDriftOnly((d) => !d)}
            style={driftOnly ? { borderColor: 'var(--color-warn)', color: 'var(--color-warn)' } : undefined}
          >
            Only drift
          </Button>
        )}
        {actions}
      </div>
      {failed.length > 0 && (
        <p style={{ fontSize: 13, color: 'var(--color-warn)', margin: '0 0 12px' }}>
          Not shown: {failed.map(([sw, e]) => `${sw} (${e})`).join(', ')}.{' '}
          <button type="button" className="chip" onClick={() => setReconnect(failed[0]?.[0] ?? null)}>
            Reconnect {failed[0]?.[0]}
          </button>
        </p>
      )}
      {error ? (
        <ReadError switchId={group ? '' : (members[0] ?? '')} message={error.message} onFixed={refetch} />
      ) : loading ? (
        <Spinner label={`Loading ${noun}`} />
      ) : (
        <DataTable<MergedRow>
          cols={cols}
          rows={driftOnly ? rows.filter(drifts) : rows}
          storageKey={storageKey}
          rowKey={(r) => r.name}
          subRows={group ? (r) => (r.sw ? undefined : holders(r).map((sw) => ({ ...r, sw }))) : undefined}
          onRowClick={
            onOpen || onOpenSwitch
              ? (r) => (r.sw && onOpenSwitch ? onOpenSwitch(r.sw, r.name) : onOpen?.(r.name))
              : undefined
          }
          empty={<p style={{ color: 'var(--color-muted)', fontSize: 14 }}>No {noun}.</p>}
          actions={rowActions ? (r) => rowActions(r, holders(r)) : undefined}
        />
      )}
      {reconnect && (
        <ReconnectModal
          switchId={reconnect}
          open
          onClose={() => setReconnect(null)}
          onDone={() => {
            setReconnect(null);
            refetch();
          }}
        />
      )}
    </section>
  );
}
