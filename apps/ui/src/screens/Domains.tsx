/**
 * Generic domain list: any registry collection namespace renders from the
 * same two components — schema columns + picker + `?include` (R7), manifest
 * views (R10), generic create (name + initial values) and delete. No
 * per-domain list code exists; a namespace is one registry row. Singletons
 * (`/evpn`, `/mlag`, …) are never tables — they render `SingletonDomain`
 * (one object, detail tabs) straight from this route.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb, Button, type RowMenuItem } from '../components/ui.js';
import { ResourceList, ViewSwitcher } from '../components/resource.js';
import { MergedList, schemaMergedColumns } from '../components/MergedList.js';
import { domainOf, singularOf } from '../lib/domains.js';
import { toIncludePatterns, useSchemaFields, useSchemaLeaves } from '../lib/schema.js';
import { CreateFlow } from './iface/CreateFlow.js';
import { DeleteFlow } from './iface/DeleteFlow.js';
import { ScopeShell } from './iface/ScopeShell.js';
import { SingletonDomain } from './SingletonDomain.js';
import { scopeBase, usePerSwitch, type Scope } from './iface/scope.js';

type Obj = Record<string, unknown>;
type Row = Obj & { __id: string };

/** Remounts per scope + domain: picker, column and sort state are read once per storage key. */
export function Domains() {
  const { switchId, groupId, domainKey = '' } = useParams();
  return <DomainList key={`${groupId ?? switchId}/${domainKey}`} />;
}

function DomainList() {
  const { switchId, groupId, domainKey = '' } = useParams();
  const def = domainOf(domainKey);
  const scope: Scope = groupId ? { kind: 'group', id: groupId } : { kind: 'switch', id: switchId ?? '' };
  const navigate = useNavigate();
  const base = scopeBase(scope);
  const fieldKey = `cumulus.${scope.kind}.${def?.key ?? 'unknown'}.v1`;
  const { leaves } = useSchemaLeaves(def?.item, def && !def.editable ? 'GET' : 'PATCH');
  const { checked, setChecked } = useSchemaFields(fieldKey, leaves, def?.fields ?? []);
  const [view, setView] = useState<string | undefined>(undefined);
  const include = def && checked.length > 0 && !view ? toIncludePatterns(def.collection, checked) : undefined;
  const list = usePerSwitch<Record<string, Obj>>(scope, def?.collection ?? '/', {
    ...(def?.rev ? { rev: def.rev } : {}),
    ...(include ? { include } : {}),
    ...(view ? { view } : {}),
    enabled: !!def,
  });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<{ name: string; members: string[] } | null>(null);
  if (!def) {
    return (
      <ScopeShell scope={scope} active="">
        <Breadcrumb trail={[{ label: scope.id, to: base }, { label: domainKey }]} onNav={navigate} />
        <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>Unknown domain.</p>
      </ScopeShell>
    );
  }
  if (def.singleton) {
    return <SingletonDomain def={def} scope={scope} />;
  }

  const objects = list.objects;

  const viewPicker = <ViewSwitcher path={def.collection} value={view} onChange={setView} />;
  const newButton = def.creatable ? (
    <Button auto variant="secondary" onClick={() => setCreating(true)} disabled={list.loading}>
      New {singularOf(def)}
    </Button>
  ) : null;
  const openDetail = (name: string) => navigate(`${base}/${def.key}/${encodeURIComponent(name)}`);

  return (
    <ScopeShell scope={scope} active={`/${def.key}`}>
      <Breadcrumb trail={[{ label: scope.id, to: base }, { label: def.label }]} onNav={navigate} />
      {scope.kind === 'switch' ? (
        <ResourceList<Row>
          switchId={scope.id}
          path={def.collection}
          pathTemplate={def.item}
          title={def.label}
          columns={[{ key: '__id', label: 'Name', always: true, value: (r) => String(r.__id) }]}
          schema
          schemaMethod={def.editable === false ? 'GET' : 'PATCH'}
          defaultFields={def.fields}
          labels={def.labels}
          rowId={(row) => row.__id}
          storageKey={fieldKey}
          emptyIcon="object"
          rev={def.rev}
          actions={<>{newButton}</>}
          onSelect={openDetail}
          rowMenu={(row): RowMenuItem[] => [
            { label: 'Open', onClick: () => openDetail(row.__id) },
            ...(def.editable === false
              ? []
              : [
                  {
                    label: `Delete ${singularOf(def)}`,
                    danger: true,
                    onClick: () => setDeleting({ name: row.__id, members: [scope.id] }),
                  } as RowMenuItem,
                ]),
          ]}
        />
      ) : (
        <MergedList
          group
          title={def.label}
          noun={def.label.toLowerCase()}
          members={list.members}
          objects={objects}
          errors={list.errors}
          loading={list.loading}
          error={list.error}
          refetch={list.refetch}
          columns={schemaMergedColumns(leaves, checked, def.labels)}
          storageKey={fieldKey}
          emptyIcon="object"
          actions={
            <>
              {newButton}
              {viewPicker}
            </>
          }
          fields={{ leaves, checked, defaults: def.fields, onChange: setChecked }}
          onOpen={openDetail}
          onOpenSwitch={(sw, name) => navigate(`/switches/${sw}/${def.key}/${encodeURIComponent(name)}`)}
          rowActions={(r, holders): RowMenuItem[] => [
            { label: 'Open', onClick: () => openDetail(r.name) },
            ...(def.editable === false
              ? []
              : [
                  {
                    label: `Delete on ${holders.length} switch${holders.length === 1 ? '' : 'es'}`,
                    danger: true,
                    onClick: () => setDeleting({ name: r.name, members: holders }),
                  } as RowMenuItem,
                ]),
          ]}
        />
      )}
      {creating && (
        <CreateFlow
          scope={scope}
          title={`New ${singularOf(def)}`}
          nameLabel={def.nameLabel ?? 'Name'}
          collection={def.collection}
          fields={checked}
          labels={def.labels}
          onClose={() => setCreating(false)}
        />
      )}
      {deleting && (
        <DeleteFlow
          scope={scope}
          name={deleting.name}
          paths={Object.fromEntries(deleting.members.map((sw) => [sw, `${def.collection}/${deleting.name}`]))}
          onClose={() => setDeleting(null)}
        />
      )}
    </ScopeShell>
  );
}
