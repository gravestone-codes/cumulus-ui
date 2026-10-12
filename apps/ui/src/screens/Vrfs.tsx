/**
 * VRF list (3C.1, M2 proof): every column, field and view comes from the
 * generics — schema columns + picker + `?include` (R7), manifest views (R10).
 * No VRF-specific list code exists; the only hand-written bits are the
 * default field set (presentation) and the delete warning.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb, type RowMenuItem } from '../components/ui.js';
import { ResourceList } from '../components/resource.js';
import { MergedList, schemaMergedColumns } from '../components/MergedList.js';
import { FieldPicker } from '../components/FieldPicker.js';
import { ViewSwitcher } from '../components/resource.js';
import { toIncludePatterns, useSchemaFields, useSchemaLeaves } from '../lib/schema.js';
import { DeleteFlow } from './iface/DeleteFlow.js';
import { ScopeShell } from './iface/ScopeShell.js';
import { scopeBase, usePerSwitch, type Scope } from './iface/scope.js';

type Obj = Record<string, unknown>;
type VrfRow = Obj & { __id: string };

const VRF_SCHEMA = '/vrf/{vrf-id}';
const VRF_FIELDS = ['router/bgp/autonomous-system', 'router/bgp/router-id', 'evpn/enable', 'table'];
const VRF_LABELS: Record<string, string> = {
  'router/bgp/autonomous-system': 'BGP AS',
  'router/bgp/router-id': 'Router ID',
  'evpn/enable': 'EVPN',
  table: 'Table',
};

export function Vrfs() {
  const { switchId, groupId } = useParams();
  const scope: Scope = groupId ? { kind: 'group', id: groupId } : { kind: 'switch', id: switchId ?? '' };
  const navigate = useNavigate();
  const base = scopeBase(scope);
  const fieldKey = scope.kind === 'group' ? 'cumulus.group-vrfs.v1' : 'cumulus.vrfs.v1';
  const { leaves } = useSchemaLeaves(VRF_SCHEMA);
  const { checked, setChecked } = useSchemaFields(fieldKey, leaves, VRF_FIELDS);
  const [view, setView] = useState<string | undefined>(undefined);
  const include = checked.length > 0 ? toIncludePatterns('/vrf', checked) : undefined;
  const list = usePerSwitch<Record<string, Obj>>(
    scope,
    '/vrf',
    include || view ? { ...(include ? { include } : {}), ...(view ? { view } : {}) } : {},
  );
  const [deleting, setDeleting] = useState<{ name: string; members: string[] } | null>(null);

  const picker =
    leaves.length > 0 ? (
      <FieldPicker leaves={leaves} checked={checked} defaults={VRF_FIELDS} onChange={setChecked} />
    ) : null;
  const viewPicker = (
    <span style={{ minWidth: 180 }}>
      <ViewSwitcher path="/vrf" value={view} onChange={setView} />
    </span>
  );

  return (
    <ScopeShell scope={scope} active="/vrfs">
      <Breadcrumb trail={[{ label: scope.id, to: base }, { label: 'VRFs' }]} onNav={navigate} />
      {scope.kind === 'switch' ? (
        <ResourceList<VrfRow>
          switchId={scope.id}
          path="/vrf"
          pathTemplate={VRF_SCHEMA}
          title="VRFs"
          columns={[{ key: '__id', label: 'Name', always: true, value: (r) => String(r.__id) }]}
          schema
          defaultFields={VRF_FIELDS}
          labels={VRF_LABELS}
          rowId={(row) => row.__id}
          storageKey="cumulus.vrfs.v1"
          rev="applied"
          onSelect={(id) => navigate(`${base}/vrfs/${id}`)}
          rowMenu={(row): RowMenuItem[] => [
            { label: 'Open', onClick: () => navigate(`${base}/vrfs/${row.__id}`) },
            {
              label: 'Delete VRF',
              danger: true,
              onClick: () => setDeleting({ name: row.__id, members: [scope.id] }),
            },
          ]}
        />
      ) : (
        <MergedList
          group
          title="VRFs"
          noun="vrfs"
          {...list}
          columns={schemaMergedColumns(leaves, checked, VRF_LABELS)}
          storageKey="cumulus.group-vrfs.v1"
          actions={
            <>
              {picker}
              {viewPicker}
            </>
          }
          onOpen={(name) => navigate(`${base}/vrfs/${name}`)}
          onOpenSwitch={(sw, name) => navigate(`/switches/${sw}/vrfs/${name}`)}
          rowActions={(r, holders): RowMenuItem[] => [
            { label: 'Open', onClick: () => navigate(`${base}/vrfs/${r.name}`) },
            {
              label: `Delete on ${holders.length} switch${holders.length === 1 ? '' : 'es'}`,
              danger: true,
              onClick: () => setDeleting({ name: r.name, members: holders }),
            },
          ]}
        />
      )}
      {deleting && (
        <DeleteFlow
          scope={scope}
          name={deleting.name}
          paths={Object.fromEntries(deleting.members.map((sw) => [sw, `/vrf/${deleting.name}`]))}
          warning={`Deleting ${deleting.name} removes the VRF and its configuration; traffic in it stops.`}
          onClose={() => setDeleting(null)}
        />
      )}
    </ScopeShell>
  );
}
