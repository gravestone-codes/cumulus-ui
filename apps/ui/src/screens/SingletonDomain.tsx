/**
 * Singleton domain screen: one NVUE object per switch (`/evpn`, `/mlag`,
 * `/router/bgp`, `/nve`, `/qos`) — never a table. A one-row table suggests a
 * collection with many members; a singleton is a single config object, so it
 * renders straight as header + Overview/Edit tabs (R8/R9), switch or group
 * alike. Collection namespaces keep using `Domains`/`DomainDetail`.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Breadcrumb, useToast } from '../components/ui.js';
import { ResourceDetail, ValueGrid } from '../components/resource.js';
import { MixedValue } from '../components/mixed.js';
import { mergeValues, presence } from '../lib/merge.js';
import { displayValue, getPath } from '../lib/format.js';
import { singularOf, type DomainDef } from '../lib/domains.js';
import { useSchemaFields, useSchemaLeaves } from '../lib/schema.js';
import { ScopeShell } from './iface/ScopeShell.js';
import { ResourceForm } from './iface/ResourceForm.js';
import { refreshInterfaces, scopeBase, usePerSwitch, type Scope } from './iface/scope.js';

type Tab = 'overview' | 'edit';

export function SingletonDomain({ def, scope }: { def: DomainDef; scope: Scope }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const base = scopeBase(scope);
  const group = scope.kind === 'group';
  const name = def.name ?? def.key;
  const read = usePerSwitch(scope, def.collection, {
    ...(def.rev ? { rev: def.rev } : {}),
    enabled: true,
  });

  const { leaves } = useSchemaLeaves(def.item, def.editable === false ? 'GET' : 'PATCH');
  const { checked } = useSchemaFields(`cumulus.${scope.kind}.${def.key}-detail.v1`, leaves, def.fields);
  const byLeaf = new Map(leaves.map((l) => [l.path, l]));
  const { present } = presence(read.members, read.objects);

  const overviewLeaves =
    checked.length > 0
      ? checked
      : [...new Set(present.flatMap((sw) => Object.keys(read.objects[sw] ?? {})))].slice(0, 24);
  const items = overviewLeaves.map((leaf) => {
    const m = mergeValues(
      Object.fromEntries(present.map((sw) => [sw, displayValue(getPath(read.objects[sw], leaf))])),
    );
    const label = def.labels[leaf] ?? byLeaf.get(leaf)?.label ?? leaf;
    if (m.kind === 'mixed' && group) {
      return {
        label,
        value: (
          <MixedValue
            groups={m.groups}
            label={`${name} ${label}`}
            onOpen={(sw) => navigate(`/switches/${encodeURIComponent(sw)}/${def.key}`)}
          />
        ),
      };
    }
    return { label, value: m.kind === 'same' ? m.value || '—' : '—' };
  });

  const editable = def.editable !== false && checked.length > 0;
  const tabs: Array<{ id: string; label: string; content: React.ReactNode }> = [
    { id: 'overview', label: 'Overview', content: <ValueGrid items={items} /> },
  ];
  if (editable) {
    tabs.push({
      id: 'edit',
      label: 'Edit',
      content: (
        <ResourceForm
          modal={false}
          scope={scope}
          objectPath={def.collection}
          name={name}
          title={singularOf(def)}
          only={checked}
          labels={def.labels}
          cfg={Object.fromEntries(present.map((sw) => [sw, read.objects[sw]]))}
          present={present}
          onClose={() => setTab('overview')}
          onApplied={() => refreshInterfaces(queryClient)}
          notify={toast}
          doneText={`${singularOf(def)} ${name}`}
        />
      ),
    });
  }

  return (
    <ScopeShell scope={scope} active={`/${def.key}`}>
      <Breadcrumb trail={[{ label: scope.id, to: base }, { label: def.label }]} onNav={navigate} />
      <ResourceDetail
        scope={scope}
        kind="generic"
        id={def.label}
        path={def.collection}
        tabs={tabs}
        activeTab={tab}
        onTabChange={(id) => setTab(id as Tab)}
        read={read}
        present={present}
      />
    </ScopeShell>
  );
}
