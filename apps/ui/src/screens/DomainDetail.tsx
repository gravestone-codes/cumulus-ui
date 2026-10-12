/**
 * Generic domain detail: header + tab slots (R8) with zero per-domain widgets.
 * Overview reads the checked schema leaves into a ValueGrid (mixed values
 * merge per member, falling back to top-level live keys when the schema is
 * bare); Edit is the schema-enumerated ResourceForm (R9); Delete the generic
 * flow (2.6). Singletons never land here — their canonical URL is the domain
 * root (`/switches/:id/evpn`), which renders `SingletonDomain`; a stale
 * `/evpn/evpn` link redirects there so one object keeps one URL.
 */
import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Breadcrumb, Button, useToast } from '../components/ui.js';
import { ResourceDetail, ValueGrid } from '../components/resource.js';
import { MixedValue } from '../components/mixed.js';
import { mergeValues, presence } from '../lib/merge.js';
import { displayValue, getPath } from '../lib/format.js';
import { domainOf, singularOf } from '../lib/domains.js';
import { useSchemaFields, useSchemaLeaves } from '../lib/schema.js';
import { ScopeShell } from './iface/ScopeShell.js';
import { DeleteFlow } from './iface/DeleteFlow.js';
import { ResourceForm } from './iface/ResourceForm.js';
import { refreshInterfaces, scopeBase, usePerSwitch, type Scope } from './iface/scope.js';

type Tab = 'overview' | 'edit';

export function DomainDetail() {
  const { switchId, groupId, domainKey = '', name = '' } = useParams();
  const def = domainOf(domainKey);
  const scope: Scope = groupId ? { kind: 'group', id: groupId } : { kind: 'switch', id: switchId ?? '' };
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [deleting, setDeleting] = useState(false);
  const base = scopeBase(scope);
  const group = scope.kind === 'group';
  const objectPath = def ? `${def.collection}/${encodeURIComponent(name)}` : name;
  const read = usePerSwitch(scope, def ? objectPath : '/', {
    ...(def?.rev ? { rev: def.rev } : {}),
    enabled: !!def && !def.singleton,
  });

  const { leaves } = useSchemaLeaves(def?.item, def && !def.editable ? 'GET' : 'PATCH');
  const { checked } = useSchemaFields(
    `cumulus.${scope.kind}.${def?.key ?? 'unknown'}-detail.v1`,
    leaves,
    def?.fields ?? [],
  );
  const byLeaf = new Map(leaves.map((l) => [l.path, l]));
  const { present } = presence(read.members, read.objects);
  if (def?.singleton) {
    return <Navigate to={`${base}/${def.key}`} replace />;
  }
  if (!def) {
    return (
      <ScopeShell scope={scope} active="">
        <Breadcrumb trail={[{ label: scope.id, to: base }, { label: domainKey }]} onNav={navigate} />
        <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>Unknown domain.</p>
      </ScopeShell>
    );
  }

  // Overview rows: checked schema leaves, or the live top-level keys when bare.
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
            onOpen={(sw) =>
              navigate(`/switches/${encodeURIComponent(sw)}/${def.key}/${encodeURIComponent(name)}`)
            }
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
          objectPath={objectPath}
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
      <Breadcrumb
        trail={[
          { label: scope.id, to: base },
          { label: def.label, to: `${base}/${def.key}` },
          { label: name },
        ]}
        onNav={navigate}
      />
      <ResourceDetail
        scope={scope}
        kind="generic"
        id={name}
        path={objectPath}
        tabs={tabs}
        activeTab={tab}
        onTabChange={(id) => setTab(id as Tab)}
        actions={
          editable ? (
            <Button auto variant="secondary" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          ) : undefined
        }
        read={read}
        present={present}
      />
      {deleting && (
        <DeleteFlow
          scope={scope}
          name={name}
          paths={Object.fromEntries(present.map((sw) => [sw, objectPath]))}
          onClose={() => setDeleting(false)}
        />
      )}
    </ScopeShell>
  );
}
