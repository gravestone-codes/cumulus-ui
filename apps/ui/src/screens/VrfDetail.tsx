/**
 * VRF detail (3C.1, M2 proof): header + tab slots (R8) with zero VRF-specific
 * widgets — Overview reads schema leaves into a ValueGrid (mixed values merge
 * per member), Edit is the schema-enumerated ResourceForm (R9), Delete the
 * generic flow (2.6). No VRF form code exists anywhere.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Breadcrumb, Button, useToast } from '../components/ui.js';
import { ResourceDetail, ValueGrid } from '../components/resource.js';
import { MixedValue } from '../components/mixed.js';
import { mergeValues, presence } from '../lib/merge.js';
import { displayValue, getPath } from '../lib/format.js';
import { useSchemaFields, useSchemaLeaves } from '../lib/schema.js';
import { ScopeShell } from './iface/ScopeShell.js';
import { DeleteFlow } from './iface/DeleteFlow.js';
import { ResourceForm } from './iface/ResourceForm.js';
import { refreshInterfaces, scopeBase, usePerSwitch, type Scope } from './iface/scope.js';

const VRF_SCHEMA = '/vrf/{vrf-id}';
const VRF_FIELDS = ['router/bgp/autonomous-system', 'router/bgp/router-id', 'evpn/enable', 'table'];
const VRF_LABELS: Record<string, string> = {
  'router/bgp/autonomous-system': 'BGP AS',
  'router/bgp/router-id': 'Router ID',
  'evpn/enable': 'EVPN',
  table: 'Table',
};

type Tab = 'overview' | 'edit';

export function VrfDetail() {
  const { switchId, groupId, vrfId = '' } = useParams();
  const scope: Scope = groupId ? { kind: 'group', id: groupId } : { kind: 'switch', id: switchId ?? '' };
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [deleting, setDeleting] = useState(false);
  const path = `/vrf/${vrfId}`;
  const cfg = usePerSwitch(scope, path, { rev: 'applied' });
  const base = scopeBase(scope);
  const group = scope.kind === 'group';

  const { leaves } = useSchemaLeaves(VRF_SCHEMA);
  const { checked } = useSchemaFields('cumulus.vrf-detail.v1', leaves, VRF_FIELDS);
  const byLeaf = new Map(leaves.map((l) => [l.path, l]));
  const { present } = presence(cfg.members, cfg.objects);

  const items = checked.map((leaf) => {
    const m = mergeValues(
      Object.fromEntries(present.map((sw) => [sw, displayValue(getPath(cfg.objects[sw], leaf))])),
    );
    const label = VRF_LABELS[leaf] ?? byLeaf.get(leaf)?.label ?? leaf;
    if (m.kind === 'mixed' && group) {
      return {
        label,
        value: (
          <MixedValue
            groups={m.groups}
            label={`${vrfId} ${label}`}
            onOpen={(sw) => navigate(`/switches/${encodeURIComponent(sw)}/vrfs/${encodeURIComponent(vrfId)}`)}
          />
        ),
      };
    }
    return { label, value: m.kind === 'same' ? m.value || '—' : '—' };
  });

  return (
    <ScopeShell scope={scope} active="/vrfs">
      <Breadcrumb
        trail={[{ label: scope.id, to: base }, { label: 'VRFs', to: `${base}/vrfs` }, { label: vrfId }]}
        onNav={navigate}
      />
      <ResourceDetail
        scope={scope}
        kind="vrf"
        id={vrfId}
        tabs={[
          { id: 'overview', label: 'Overview', content: <ValueGrid items={items} /> },
          {
            id: 'edit',
            label: 'Edit',
            content: (
              <ResourceForm
                modal={false}
                scope={scope}
                objectPath={path}
                name={vrfId}
                title="VRF"
                only={checked}
                labels={VRF_LABELS}
                cfg={cfg.objects}
                present={present}
                onClose={() => setTab('overview')}
                onApplied={() => refreshInterfaces(queryClient)}
                notify={toast}
                doneText={`VRF ${vrfId}`}
              />
            ),
          },
        ]}
        activeTab={tab}
        onTabChange={(id) => setTab(id as Tab)}
        actions={
          <Button auto variant="secondary" onClick={() => setDeleting(true)}>
            Delete
          </Button>
        }
        read={cfg}
        present={present}
      />
      {deleting && (
        <DeleteFlow
          scope={scope}
          name={vrfId}
          paths={Object.fromEntries(present.map((sw) => [sw, path]))}
          warning={`Deleting ${vrfId} removes the VRF and its configuration; traffic in it stops.`}
          onClose={() => setDeleting(false)}
        />
      )}
    </ScopeShell>
  );
}
