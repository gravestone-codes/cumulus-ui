/**
 * Bridge domains list (3B.1) for one switch or a group. Switch: the generic
 * ResourceList over applied config (a domain without member ports has no
 * operational state yet). Group: MergedList — one row per domain, n/m
 * presence, mixed values. Both read `/bridge/domain` → S4.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb, Button } from '../components/ui.js';
import { ResourceList, ViewSwitcher } from '../components/resource.js';
import { type GridColumn } from '../components/DataTable.js';
import { MergedList, schemaMergedColumns } from '../components/MergedList.js';
import { toIncludePatterns, useSchemaFields, useSchemaLeaves } from '../lib/schema.js';
import { CreateFlow } from './iface/CreateFlow.js';
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
  const [view, setView] = useState<string | undefined>(undefined);
  const include = checked.length > 0 && !view ? toIncludePatterns('/bridge/domain', checked) : undefined;
  const list = usePerSwitch<Record<string, Obj>>(scope, '/bridge/domain', {
    rev: 'applied',
    ...(include ? { include } : {}),
    ...(view ? { view } : {}),
    enabled: scope.kind === 'group',
  });
  const [creating, setCreating] = useState(false);
  const newButton = (
    <Button auto variant="secondary" onClick={() => setCreating(true)}>
      New bridge domain
    </Button>
  );

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
          emptyIcon="bridge"
          rev="applied"
          actions={newButton}
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
          emptyIcon="bridge"
          actions={
            <>
              {newButton}
              <ViewSwitcher path="/bridge/domain" value={view} onChange={setView} />
            </>
          }
          hideEmpty={!!view}
          fields={{ leaves, checked, defaults: BRIDGE_FIELDS, onChange: setChecked }}
          onOpen={(name) => navigate(`${base}/bridge/${encodeURIComponent(name)}`)}
          onOpenSwitch={(sw, name) =>
            navigate(`/switches/${encodeURIComponent(sw)}/bridge/${encodeURIComponent(name)}`)
          }
        />
      )}
      {creating && (
        <CreateFlow
          scope={scope}
          title="New bridge domain"
          nameLabel="Bridge domain"
          collection="/bridge/domain"
          fields={['type', 'vlan', 'untagged']}
          labels={BRIDGE_LABELS}
          onClose={() => setCreating(false)}
        />
      )}
    </ScopeShell>
  );
}
