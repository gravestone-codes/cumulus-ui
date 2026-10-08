/**
 * Interfaces list (3A.1) for one switch or a group (design §1A, §5A).
 * Switch: the generic ResourceList. Group: one row per interface name
 * across members — agreeing values plain, disagreeing ones "mixed",
 * presence as n/m — expandable to one row per switch. New bond /
 * sub-interface and delete ride the same ChangeFlow in both scopes.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Breadcrumb, Button, type RowMenuItem } from '../components/ui.js';
import { ResourceList } from '../components/resource.js';
import { type GridColumn } from '../components/DataTable.js';
import { holdersOf, MergedList, type MergedColumn, type MergedRow } from '../components/MergedList.js';
import { firstDefined, ifaceState } from '../lib/format.js';
import { ScopeShell } from './iface/ScopeShell.js';
import { CreateInterface, DeleteInterface } from './iface/CreateInterface.js';
import { scopeBase, usePerSwitch, type Scope } from './iface/scope.js';

type Obj = Record<string, unknown>;
type IfaceRow = Obj & { __id: string };

/** Types the app may create and delete (physical ports, eth and lo are the switch's). */
const DELETABLE = ['bond', 'sub'];

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
        <MergedList
          group
          title="Interfaces"
          noun="interfaces"
          {...list}
          columns={GROUP_COLUMNS}
          extra={[stateColumn(list.members)]}
          storageKey="cumulus.group-interfaces.v1"
          actions={newButton}
          onOpen={(name) => navigate(`${base}/interfaces/${name}`)}
          onOpenSwitch={(sw, name) => navigate(`/switches/${sw}/interfaces/${name}`)}
          rowActions={(r, holders): RowMenuItem[] => [
            { label: 'Open', onClick: () => navigate(`${base}/interfaces/${r.name}`) },
            {
              label: `Delete on ${holders.length} switch${holders.length === 1 ? '' : 'es'}`,
              danger: true,
              disabled: !holders.every((sw) => DELETABLE.includes(String(r.per[sw]?.['type']))),
              title: 'Only bonds and sub-interfaces can be deleted',
              onClick: () => setDeleting({ name: r.name, members: holders }),
            },
          ]}
        />
      )}
      {creating && (
        <CreateInterface
          scope={scope}
          members={list.members}
          existing={existing}
          lists={list.objects}
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

/** Value columns merged across members (drift = any of them mixed, or absent somewhere). */
const GROUP_COLUMNS: MergedColumn[] = [
  { key: 'type', label: 'Type', get: (o) => firstDefined(o, 'type') ?? '' },
  { key: 'speed', label: 'Speed', get: (o) => firstDefined(o, 'link/speed') ?? '' },
  { key: 'mtu', label: 'MTU', get: (o) => firstDefined(o, 'link/mtu') ?? '' },
  { key: 'description', label: 'Description', get: (o) => firstDefined(o, 'description') ?? '' },
];

/** State badges, counted per state across a group row's holders. */
function stateColumn(members: string[]): GridColumn<MergedRow> {
  const states = (r: MergedRow) => holdersOf(r, members).map((sw) => ifaceState(r.per[sw]) ?? 'unknown');
  return {
    key: 'state',
    label: 'State',
    value: (r) => states(r).join(' '),
    render: (r) => {
      const counts = new Map<string, number>();
      for (const s of states(r)) counts.set(s, (counts.get(s) ?? 0) + 1);
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
  };
}
