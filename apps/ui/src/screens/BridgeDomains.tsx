/**
 * Bridge domains list (3B.1) for one switch or a group. Switch: the generic
 * ResourceList over applied config (a domain without member ports has no
 * operational state yet). Group: MergedList — one row per domain, n/m
 * presence, mixed values. Both read `/bridge/domain` → S4.
 */
import { useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb } from '../components/ui.js';
import { ResourceList } from '../components/resource.js';
import { type GridColumn } from '../components/DataTable.js';
import { MergedList, type MergedColumn } from '../components/MergedList.js';
import { getPath } from '../lib/format.js';
import { displayValue } from './iface/ConfigTab.js';
import { ScopeShell } from './iface/ScopeShell.js';
import { scopeBase, usePerSwitch, type Scope } from './iface/scope.js';

type Obj = Record<string, unknown>;

const COLUMNS: MergedColumn[] = [
  { key: 'type', label: 'Type', get: (o) => displayValue(getPath(o, 'type')) },
  { key: 'vlans', label: 'VLANs', get: (o) => displayValue(getPath(o, 'vlan')) },
  { key: 'untagged', label: 'Untagged', get: (o) => displayValue(getPath(o, 'untagged')) },
  { key: 'snooping', label: 'Snooping', get: (o) => displayValue(getPath(o, 'multicast/snooping/enable')) },
];

const SWITCH_COLUMNS: GridColumn<Obj & { __id: string }>[] = [
  { key: '__id', label: 'Name', always: true, value: (r) => r.__id },
  ...COLUMNS.map((c) => ({ key: c.key, label: c.label, value: (r: Obj) => c.get(r) || '—' })),
];

export function BridgeDomains() {
  const { switchId, groupId } = useParams();
  const scope: Scope = groupId ? { kind: 'group', id: groupId } : { kind: 'switch', id: switchId ?? '' };
  const navigate = useNavigate();
  const base = scopeBase(scope);
  const list = usePerSwitch<Record<string, Obj>>(scope, '/bridge/domain', {
    rev: 'applied',
    enabled: scope.kind === 'group',
  });

  return (
    <ScopeShell scope={scope} active="/bridge">
      <Breadcrumb trail={[{ label: scope.id, to: base }, { label: 'Bridge' }]} onNav={navigate} />
      {scope.kind === 'switch' ? (
        <ResourceList<Obj & { __id: string }>
          switchId={scope.id}
          path="/bridge/domain"
          pathTemplate="/bridge/domain"
          title="Bridge domains"
          columns={SWITCH_COLUMNS}
          rowId={(row) => row.__id}
          storageKey="cumulus.bridge-domains.v1"
          rev="applied"
          onSelect={(id) => navigate(`${base}/bridge/${encodeURIComponent(id)}`)}
        />
      ) : (
        <MergedList
          group
          title="Bridge domains"
          noun="domains"
          {...list}
          columns={COLUMNS}
          storageKey="cumulus.group-bridge-domains.v1"
          onOpen={(name) => navigate(`${base}/bridge/${encodeURIComponent(name)}`)}
          onOpenSwitch={(sw, name) =>
            navigate(`/switches/${encodeURIComponent(sw)}/bridge/${encodeURIComponent(name)}`)
          }
        />
      )}
    </ScopeShell>
  );
}
