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
import { MergedList, schemaMergedColumns } from '../components/MergedList.js';
import { FieldPicker } from '../components/FieldPicker.js';
import { toIncludePatterns, useSchemaFields, useSchemaLeaves } from '../lib/schema.js';
import { ScopeShell } from './iface/ScopeShell.js';
import { scopeBase, usePerSwitch, type Scope } from './iface/scope.js';

type Obj = Record<string, unknown>;

/** Identity stays an injected adapter; the rest comes from the schema (2.1). */
const SWITCH_ADAPTERS: GridColumn<Obj & { __id: string }>[] = [
  { key: '__id', label: 'Name', always: true, value: (r) => r.__id },
];

const BRIDGE_FIELDS = ['type', 'vlan', 'untagged', 'multicast/snooping/enable'];
const BRIDGE_LABELS: Record<string, string> = {
  type: 'Type',
  vlan: 'VLANs',
  untagged: 'Untagged',
  'multicast/snooping/enable': 'Snooping',
};

const BRIDGE_SCHEMA = '/bridge/domain/{domain-id}';

export function BridgeDomains() {
  const { switchId, groupId } = useParams();
  const scope: Scope = groupId ? { kind: 'group', id: groupId } : { kind: 'switch', id: switchId ?? '' };
  const navigate = useNavigate();
  const base = scopeBase(scope);
  const fieldKey = scope.kind === 'group' ? 'cumulus.group-bridge-domains.v1' : 'cumulus.bridge-domains.v1';
  const { leaves } = useSchemaLeaves(BRIDGE_SCHEMA);
  const { checked, setChecked } = useSchemaFields(fieldKey, leaves, BRIDGE_FIELDS);
  const include = checked.length > 0 ? toIncludePatterns('/bridge/domain', checked) : undefined;
  const list = usePerSwitch<Record<string, Obj>>(scope, '/bridge/domain', {
    rev: 'applied',
    ...(include ? { include } : {}),
    enabled: scope.kind === 'group',
  });
  const picker =
    leaves.length > 0 ? (
      <FieldPicker leaves={leaves} checked={checked} defaults={BRIDGE_FIELDS} onChange={setChecked} />
    ) : null;

  return (
    <ScopeShell scope={scope} active="/bridge">
      <Breadcrumb trail={[{ label: scope.id, to: base }, { label: 'Bridge' }]} onNav={navigate} />
      {scope.kind === 'switch' ? (
        <ResourceList<Obj & { __id: string }>
          switchId={scope.id}
          path="/bridge/domain"
          pathTemplate="/bridge/domain/{domain-id}"
          title="Bridge domains"
          columns={SWITCH_ADAPTERS}
          schema
          defaultFields={BRIDGE_FIELDS}
          labels={BRIDGE_LABELS}
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
          columns={schemaMergedColumns(leaves, checked, BRIDGE_LABELS)}
          storageKey="cumulus.group-bridge-domains.v1"
          actions={picker}
          onOpen={(name) => navigate(`${base}/bridge/${encodeURIComponent(name)}`)}
          onOpenSwitch={(sw, name) =>
            navigate(`/switches/${encodeURIComponent(sw)}/bridge/${encodeURIComponent(name)}`)
          }
        />
      )}
    </ScopeShell>
  );
}
