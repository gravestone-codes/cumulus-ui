/**
 * Interfaces list (3A.1) for one switch or a group (design §1A, §5A).
 * Switch: the generic ResourceList. Group: one row per interface name
 * across members — agreeing values plain, disagreeing ones "mixed",
 * presence as n/m — expandable to one row per switch. New bond /
 * sub-interface and delete ride the same ChangeFlow in both scopes.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Breadcrumb, Button, ReconnectModal, Spinner, type RowMenuItem } from '../components/ui.js';
import { ReadError, ResourceList } from '../components/resource.js';
import { DataTable, type GridColumn } from '../components/DataTable.js';
import { MixedValue } from '../components/mixed.js';
import { firstDefined, ifaceState } from '../lib/format.js';
import { mergeValues } from '../lib/merge.js';
import { ScopeShell } from './iface/ScopeShell.js';
import { CreateInterface, DeleteInterface } from './iface/CreateInterface.js';
import { scopeBase, usePerSwitch, type Scope } from './iface/scope.js';

type Obj = Record<string, unknown>;
type IfaceRow = Obj & { __id: string };

/** Types the app may create and delete (physical ports, eth and lo are the switch's). */
const DELETABLE = ['bond', 'sub'];
const PORT_TYPES = ['swp', 'bond'];

const stateTone = (s: string | undefined) => (s === 'up' ? 'pass' : s === 'down' ? 'fail' : 'muted');

const SWITCH_COLUMNS: GridColumn<IfaceRow>[] = [
  { key: '__id', label: 'Name', always: true, value: (r) => String(r.__id) },
  {
    key: 'state',
    label: 'State',
    value: (r) => ifaceState(r) ?? '—',
    render: (r) => <Badge tone={stateTone(ifaceState(r))}>{ifaceState(r) ?? 'unknown'}</Badge>,
  },
  { key: 'type', label: 'Type', value: (r) => firstDefined(r, 'type') ?? '—' },
  { key: 'speed', label: 'Speed', value: (r) => firstDefined(r, 'link/speed') ?? '—' },
  { key: 'mtu', label: 'MTU', value: (r) => firstDefined(r, 'link/mtu') ?? '—' },
  { key: 'description', label: 'Description', value: (r) => firstDefined(r, 'description') ?? '—' },
];

export function Interfaces() {
  const { switchId, groupId } = useParams();
  const scope: Scope = groupId ? { kind: 'group', id: groupId } : { kind: 'switch', id: switchId ?? '' };
  const navigate = useNavigate();
  const base = scopeBase(scope);
  const list = usePerSwitch<Record<string, Obj>>(scope, '/interface');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<{ name: string; members: string[] } | null>(null);

  const existing = Object.fromEntries(list.members.map((sw) => [sw, Object.keys(list.objects[sw] ?? {})]));
  const ports = [
    ...new Set(
      list.members.flatMap((sw) =>
        Object.entries(list.objects[sw] ?? {})
          .filter(([, o]) => PORT_TYPES.includes(String(o?.['type'])))
          .map(([n]) => n),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const newButton = (
    <Button auto variant="secondary" onClick={() => setCreating(true)} disabled={list.loading}>
      New interface
    </Button>
  );

  return (
    <ScopeShell scope={scope} active="/interfaces">
      <Breadcrumb trail={[{ label: scope.id, to: base }, { label: 'Interfaces' }]} onNav={navigate} />
      {scope.kind === 'switch' ? (
        <ResourceList<IfaceRow>
          switchId={scope.id}
          path="/interface"
          pathTemplate="/interface/{interface-id}"
          title="Interfaces"
          columns={SWITCH_COLUMNS}
          rowId={(row) => row.__id}
          storageKey="cumulus.interfaces.v1"
          rev="operational"
          actions={newButton}
          onSelect={(id) => navigate(`${base}/interfaces/${id}`)}
          rowMenu={(row): RowMenuItem[] => [
            { label: 'Open', onClick: () => navigate(`${base}/interfaces/${row.__id}`) },
            {
              label: 'Delete interface',
              danger: true,
              disabled: !DELETABLE.includes(String(row['type'])),
              title: DELETABLE.includes(String(row['type']))
                ? undefined
                : 'Only bonds and sub-interfaces can be deleted',
              onClick: () => setDeleting({ name: row.__id, members: [scope.id] }),
            },
          ]}
        />
      ) : (
        <GroupList
          list={list}
          actions={newButton}
          onOpen={(name) => navigate(`${base}/interfaces/${name}`)}
          onOpenSwitch={(sw, name) => navigate(`/switches/${sw}/interfaces/${name}`)}
          onDelete={(name, members) => setDeleting({ name, members })}
        />
      )}
      {creating && (
        <CreateInterface
          scope={scope}
          members={list.members}
          existing={existing}
          ports={ports}
          onClose={() => setCreating(false)}
        />
      )}
      {deleting && (
        <DeleteInterface
          scope={scope}
          ifname={deleting.name}
          members={deleting.members}
          onClose={() => setDeleting(null)}
        />
      )}
    </ScopeShell>
  );
}

/** One group row: an interface name and every member's object for it. */
type GroupRow = { name: string; per: Record<string, Obj | undefined>; sw?: string };

function GroupList({
  list,
  actions,
  onOpen,
  onOpenSwitch,
  onDelete,
}: {
  list: ReturnType<typeof usePerSwitch<Record<string, Obj>>>;
  actions: React.ReactNode;
  onOpen: (name: string) => void;
  onOpenSwitch: (sw: string, name: string) => void;
  onDelete: (name: string, members: string[]) => void;
}) {
  const [driftOnly, setDriftOnly] = useState(false);
  const [reconnect, setReconnect] = useState<string | null>(null);
  const { members } = list;
  const names = [...new Set(members.flatMap((sw) => Object.keys(list.objects[sw] ?? {})))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  const rows: GroupRow[] = names.map((name) => ({
    name,
    per: Object.fromEntries(members.map((sw) => [sw, list.objects[sw]?.[name]])),
  }));
  const holders = (r: GroupRow) => (r.sw ? [r.sw] : members.filter((sw) => r.per[sw] !== undefined));
  const merged = (r: GroupRow, leaf: string) =>
    mergeValues(Object.fromEntries(holders(r).map((sw) => [sw, firstDefined(r.per[sw], leaf) ?? ''])));
  const drifts = (r: GroupRow) =>
    holders(r).length < members.length ||
    ['link/mtu', 'link/speed', 'description', 'type'].some((l) => merged(r, l).kind === 'mixed');

  const cell = (r: GroupRow, leaf: string, label: string) => {
    const m = merged(r, leaf);
    if (m.kind === 'mixed')
      return (
        <MixedValue
          groups={m.groups}
          label={`${r.name} ${label}`}
          onOpen={(sw) => onOpenSwitch(sw, r.name)}
        />
      );
    return m.kind === 'same' && m.value !== '' ? m.value : '—';
  };
  const text = (r: GroupRow, leaf: string) => {
    const m = merged(r, leaf);
    return m.kind === 'mixed' ? 'mixed' : m.kind === 'same' ? m.value || '—' : '—';
  };

  const cols: GridColumn<GroupRow>[] = [
    { key: 'name', label: 'Name', always: true, value: (r) => r.sw ?? r.name },
    {
      key: 'present',
      label: 'Present',
      value: (r) => (r.sw ? '' : `${holders(r).length}/${members.length}`),
      render: (r) =>
        r.sw ? null : (
          <span style={{ color: holders(r).length < members.length ? 'var(--color-warn)' : undefined }}>
            {holders(r).length}/{members.length}
          </span>
        ),
    },
    {
      key: 'state',
      label: 'State',
      value: (r) =>
        holders(r)
          .map((sw) => ifaceState(r.per[sw]) ?? 'unknown')
          .join(' '),
      render: (r) => {
        const counts = new Map<string, number>();
        for (const sw of holders(r)) {
          const s = ifaceState(r.per[sw]) ?? 'unknown';
          counts.set(s, (counts.get(s) ?? 0) + 1);
        }
        return (
          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
            {[...counts].map(([s, n]) => (
              <Badge key={s} tone={stateTone(s)}>
                {r.sw ? s : `${s} ${n}`}
              </Badge>
            ))}
          </span>
        );
      },
    },
    { key: 'type', label: 'Type', value: (r) => text(r, 'type'), render: (r) => cell(r, 'type', 'type') },
    {
      key: 'speed',
      label: 'Speed',
      value: (r) => text(r, 'link/speed'),
      render: (r) => cell(r, 'link/speed', 'speed'),
    },
    {
      key: 'mtu',
      label: 'MTU',
      value: (r) => text(r, 'link/mtu'),
      render: (r) => cell(r, 'link/mtu', 'MTU'),
    },
    {
      key: 'description',
      label: 'Description',
      value: (r) => text(r, 'description'),
      render: (r) => cell(r, 'description', 'description'),
    },
  ];

  const failed = Object.entries(list.errors);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Interfaces</h1>
        {!list.loading && (
          <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>
            {members.length} switch{members.length === 1 ? '' : 'es'} · {names.length} interfaces
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Button
          auto
          variant="secondary"
          aria-pressed={driftOnly}
          onClick={() => setDriftOnly((d) => !d)}
          style={driftOnly ? { borderColor: 'var(--color-warn)', color: 'var(--color-warn)' } : undefined}
        >
          Only drift
        </Button>
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
      {list.error ? (
        <ReadError switchId="" message={list.error.message} onFixed={list.refetch} />
      ) : list.loading ? (
        <Spinner label="Loading interfaces" />
      ) : (
        <DataTable<GroupRow>
          cols={cols}
          rows={driftOnly ? rows.filter(drifts) : rows}
          storageKey={`cumulus.group-interfaces.v1`}
          rowKey={(r) => r.name}
          subRows={(r) => (r.sw ? undefined : holders(r).map((sw) => ({ ...r, sw })))}
          onRowClick={(r) => (r.sw ? onOpenSwitch(r.sw, r.name) : onOpen(r.name))}
          empty={
            <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>
              No interfaces on this group’s switches.
            </p>
          }
          actions={(r): RowMenuItem[] => [
            { label: 'Open', onClick: () => onOpen(r.name) },
            {
              label: `Delete on ${holders(r).length} switch${holders(r).length === 1 ? '' : 'es'}`,
              danger: true,
              disabled: !holders(r).every((sw) => DELETABLE.includes(String(r.per[sw]?.['type']))),
              title: 'Only bonds and sub-interfaces can be deleted',
              onClick: () => onDelete(r.name, holders(r)),
            },
          ]}
        />
      )}
      {reconnect && (
        <ReconnectModal
          switchId={reconnect}
          open
          onClose={() => setReconnect(null)}
          onDone={() => {
            setReconnect(null);
            list.refetch();
          }}
        />
      )}
    </section>
  );
}
