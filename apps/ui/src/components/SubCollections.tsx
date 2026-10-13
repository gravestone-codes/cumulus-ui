import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type StageCall } from '../lib/api.js';
import { itemSchema, leafLabel, scalarLeaves } from '../lib/schema.js';
import { MiniTable } from './cards.js';
import { Button, Modal, PromptModal, useToast } from './ui.js';
import { ChangeFlow } from '../screens/iface/ChangeFlow.js';
import { CreateFlow, OBJECT_NAME } from '../screens/iface/CreateFlow.js';
import { MemberActions } from './SectionActions.js';
import { DeleteFlow } from '../screens/iface/DeleteFlow.js';
import { ResourceForm } from '../screens/iface/ResourceForm.js';
import { refreshInterfaces, type Scope } from '../screens/iface/scope.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Drill depth through singleton objects (VRF → router → bgp → neighbor
 * tables resolve within three hops). Intermediate prefixes are usually NOT
 * addressable API paths, so the descent walks the already-fetched parent
 * schema — never extra per-hop reads (which 404).
 */
const DRILL_DEPTH = 3;

/**
 * Map-typed children of an item schema (flattened: `additionalProperties`
 * hoisted): every nested row collection under the object. `@action`
 * operations are never row collections.
 */
export function mapKeys(item: unknown): string[] {
  if (!isObj(item) || !isObj(item.properties)) return [];
  return Object.entries(item.properties as Record<string, unknown>)
    .filter(([k, v]) => !k.startsWith('@') && isObj(v) && isObj((v as Obj).additionalProperties))
    .map(([k]) => k);
}

/**
 * Singleton-object children worth drilling through (router → bgp): objects,
 * never maps, never actions. Row collections below them surface as
 * `Bgp › Neighbor` tables.
 */
export function childObjectKeys(item: unknown): string[] {
  if (!isObj(item) || !isObj(item.properties)) return [];
  return Object.entries(item.properties as Record<string, unknown>)
    .filter(
      ([k, v]) =>
        !k.startsWith('@') &&
        isObj(v) &&
        !isObj((v as Obj).additionalProperties) &&
        isObj((v as Obj).properties),
    )
    .map(([k]) => k);
}

/** Any nested content (maps or drillable objects) below an item schema. */
export function hasChildren(item: unknown): boolean {
  if (!isObj(item) || !isObj(item.properties)) return false;
  const props = item.properties as Record<string, unknown>;
  return Object.entries(props).some(
    ([k, v]) =>
      !k.startsWith('@') &&
      isObj(v) &&
      (isObj((v as Obj).additionalProperties) || isObj((v as Obj).properties)),
  );
}

/**
 * Any manifest template at or below a concrete path (`{id}` segments are
 * wildcards). Gates drill-down so object children with nothing below them
 * stay quiet.
 */
export function hasDeeper(routes: Record<string, string[]>, basePath: string): boolean {
  const segs = basePath.split('/');
  return Object.keys(routes).some((t) => {
    const ts = t.split('/');
    return (
      ts.length >= segs.length && ts.slice(0, segs.length).every((s, i) => s.startsWith('{') || s === segs[i])
    );
  });
}

/**
 * Match a concrete probe path against manifest templates (`{id}` wildcards):
 * the method set of the first template hit. The backend resolves the same way.
 */
export function probeMethods(routes: Record<string, string[]>, probe: string): string[] {
  const segs = probe.split('/');
  for (const [tmpl, methods] of Object.entries(routes)) {
    const ts = tmpl.split('/');
    if (ts.length !== segs.length) continue;
    if (ts.every((s, i) => s.startsWith('{') || s === segs[i])) return methods;
  }
  return [];
}

/**
 * Row management for every map nested under one object (NTP servers, DHCP
 * pools, AAA servers, SNMP communities, BGP peers via VRF → router → bgp…):
 * list, add, edit, delete — all schema-driven, no per-map code. Second
 * consumer (with DomainDetail) of the split-index family; promote to a
 * registry pattern on the third.
 */
export function SubCollections({
  scope,
  parentPath,
  objects,
  present,
}: {
  scope: Scope;
  /** Concrete object path holding the maps (e.g. `/system/aaa`). */
  parentPath: string;
  /** Parent object per switch (`undefined` = absent there). */
  objects: Record<string, Obj | undefined>;
  /** Members to offer (switches holding the parent). */
  present: string[];
}) {
  const parent = useQuery({
    queryKey: ['spec-fields', parentPath, 'GET'],
    queryFn: () => api.fields(parentPath, 'GET'),
    staleTime: Infinity,
    retry: false,
  });
  const manifest = useQuery({ queryKey: ['manifest'], queryFn: () => api.manifest(), staleTime: 300_000 });
  if (parent.isError) return null;
  if (parent.isPending || !manifest.data) return null;
  const item = itemSchema(parent.data.schema);
  return (
    <SubTables
      scope={scope}
      basePath={parentPath}
      objects={objects}
      present={present}
      routes={manifest.data.routes}
      item={item}
      depth={DRILL_DEPTH}
    />
  );
}

function SubTables({
  scope,
  basePath,
  objects,
  present,
  routes,
  item,
  depth,
  crumb,
  nested,
}: {
  scope: Scope;
  /** Concrete path of the object this schema describes. */
  basePath: string;
  objects: Record<string, Obj | undefined>;
  present: string[];
  routes: Record<string, string[]>;
  item: unknown;
  depth: number;
  /** Title prefix for drilled tables (`Bgp › `). */
  crumb?: string;
  /** Nested renders (drills, member modals) skip the card-body top margin. */
  nested?: boolean;
}) {
  const subs = mapKeys(item);
  // Bare maps (`server: {type: object, properties: {}}`, e.g. DNS servers):
  // no shape in the schema, but member paths in the manifest prove rows live
  // here — key-only rows the name alone creates.
  if (isObj(item) && isObj((item as Obj).properties)) {
    for (const k of Object.keys((item as Obj).properties as Record<string, unknown>)) {
      if (k.startsWith('@') || subs.includes(k)) continue;
      if (probeMethods(routes, `${basePath}/${k}/-`).length > 0) subs.push(k);
    }
  }
  const drills =
    depth > 0 && isObj(item) && isObj((item as Obj).properties)
      ? childObjectKeys(item).filter((k) => hasDeeper(routes, `${basePath}/${k}`))
      : [];
  if (subs.length === 0 && drills.length === 0) return null;
  const props =
    isObj(item) && isObj((item as Obj).properties)
      ? ((item as Obj).properties as Record<string, unknown>)
      : {};
  return (
    <div style={{ display: 'grid', gap: 16, ...(nested ? {} : { marginTop: 16 }) }}>
      {subs.map((sub) => (
        <SubTable
          key={sub}
          scope={scope}
          parentPath={basePath}
          sub={sub}
          objects={objects}
          present={present}
          crumb={crumb}
          methods={probeMethods(routes, `${basePath}/${sub}/-`)}
        />
      ))}
      {drills.map((key) => (
        <SubTables
          key={key}
          scope={scope}
          basePath={`${basePath}/${key}`}
          objects={Object.fromEntries(
            present.map((sw) => [sw, isObj(objects[sw]?.[key]) ? (objects[sw]?.[key] as Obj) : undefined]),
          )}
          present={present}
          routes={routes}
          item={(props[key] ?? null) as unknown}
          depth={depth - 1}
          crumb={`${crumb ?? ''}${leafLabel(key)} › `}
          nested
        />
      ))}
    </div>
  );
}

function SubTable({
  scope,
  parentPath,
  sub,
  objects,
  present,
  crumb,
  methods,
}: {
  scope: Scope;
  parentPath: string;
  sub: string;
  objects: Record<string, Obj | undefined>;
  present: string[];
  crumb?: string;
  methods: string[];
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // Key-only rows (DNS servers, search lists…): the name IS the config, so
  // creation stages an empty PATCH on a fresh path instead of a values form.
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickName, setQuickName] = useState<string | null>(null);
  const [quickCalls, setQuickCalls] = useState<Record<string, StageCall[]> | null>(null);
  const subPath = `${parentPath}/${sub}`;
  const title = `${crumb ?? ''}${leafLabel(sub)}`;
  const memberFields = useQuery({
    queryKey: ['spec-fields', `${subPath}/-`, 'PATCH'],
    queryFn: () => api.fields(`${subPath}/-`, 'PATCH'),
    staleTime: Infinity,
    retry: false,
  });
  const memberGet = useQuery({
    queryKey: ['spec-fields', `${subPath}/-`, 'GET'],
    queryFn: () => api.fields(`${subPath}/-`, 'GET'),
    staleTime: Infinity,
    retry: false,
  });
  const memberItem = memberFields.data ? itemSchema(memberFields.data.schema) : null;
  const createLeaves = memberItem
    ? scalarLeaves(memberItem, '', 0, 4)
        .map((l) => l.path)
        .filter((p) => !p.split('/').some((seg) => seg.startsWith('@')))
    : [];
  const memberGetItem = memberGet.data ? itemSchema(memberGet.data.schema) : null;
  // Manifest evidence for the member template (placeholders match `{id}`).
  const manifest = useQuery({ queryKey: ['manifest'], queryFn: () => api.manifest(), staleTime: 300_000 });
  const memberRoutes = manifest.data?.routes ?? {};
  const holders = (id: string) =>
    present.filter((sw) => isObj(objects[sw]?.[sub]) && (objects[sw]?.[sub] as Obj)[id] !== undefined);
  const ids = [
    ...new Set(
      present.flatMap((sw) =>
        Object.keys(isObj(objects[sw]?.[sub]) ? ((objects[sw]?.[sub] as Obj) ?? {}) : {}),
      ),
    ),
  ].sort();
  const canWrite = methods.includes('patch');
  const canDelete = methods.includes('delete');
  if (ids.length === 0 && !canWrite) return null;
  const refreshed = () => refreshInterfaces(queryClient);
  const singular = title.endsWith('s') && !title.endsWith('ss') ? title.slice(0, -1) : `${title} entry`;
  const keyOnly = canWrite && !!memberFields.data && createLeaves.length === 0;
  // Row opens when something lives behind it: values to edit, or children to manage.
  const openable = canWrite && (createLeaves.length > 0 || hasChildren(memberGetItem));
  const closeQuick = () => {
    setQuickOpen(false);
    setQuickError(null);
    setQuickName(null);
    setQuickCalls(null);
  };
  const submitQuick = (name: string) => {
    if (!OBJECT_NAME.test(name)) {
      setQuickError('Letters, digits, dot, dash, underscore, colon — no slashes.');
      return;
    }
    const missing = present.filter((sw) => holders(name).indexOf(sw) === -1);
    if (missing.length === 0) {
      setQuickError(`${name} already exists on every switch in scope — nothing to create.`);
      return;
    }
    setQuickError(null);
    setQuickName(name);
    setQuickCalls(
      Object.fromEntries(
        missing.map((sw) => [
          sw,
          [{ path: `${subPath}/${encodeURIComponent(name)}`, method: 'PATCH' as const, body: {} }],
        ]),
      ),
    );
  };
  const editHolders = editing ? holders(editing) : [];
  const editMember = (
    editing ? editHolders.map((sw) => (objects[sw]?.[sub] as Obj)?.[editing]) : []
  ) as Array<Obj | undefined>;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h4
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--color-muted)',
            margin: 0,
            flex: '1 0 auto',
          }}
        >
          {title} · {ids.length}
        </h4>
        {canWrite && memberFields.data && (
          <Button auto variant="secondary" onClick={() => (keyOnly ? setQuickOpen(true) : setAdding(true))}>
            New
          </Button>
        )}
      </div>
      {ids.length > 0 ? (
        <MiniTable
          cols={[
            { label: 'Name', cell: (id: string) => id },
            {
              label: scope.kind === 'group' ? 'Switches' : 'Present',
              align: 'right',
              cell: (id: string) =>
                scope.kind === 'group' ? `${holders(id).length}/${present.length}` : 'yes',
            },
            ...(canDelete
              ? [
                  {
                    label: '',
                    align: 'right' as const,
                    cell: (id: string) => (
                      <button
                        type="button"
                        aria-label={`Delete ${id}`}
                        title={`Delete ${id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleting(id);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--color-muted)',
                          cursor: 'pointer',
                          font: 'inherit',
                          fontSize: 15,
                          padding: '0 2px',
                        }}
                      >
                        ×
                      </button>
                    ),
                  },
                ]
              : []),
          ]}
          rows={ids}
          rowKey={(id) => id}
          onRow={openable ? (id) => setEditing(id) : canDelete ? (id) => setDeleting(id) : undefined}
        />
      ) : (
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0 }}>
          No {title.toLowerCase()} configured.
        </p>
      )}
      {adding && (
        <CreateFlow
          scope={scope}
          title={`New ${singular.toLowerCase()}`}
          nameLabel="Name"
          collection={subPath}
          fields={createLeaves}
          onClose={() => setAdding(false)}
          onApplied={refreshed}
        />
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={`${title} ${editing}`} width={640}>
          {editHolders.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
              <MemberActions
                scope={scope}
                memberPath={`${subPath}/${encodeURIComponent(editing)}`}
                members={editHolders}
              />
            </div>
          )}
          {createLeaves.length > 0 && (
            <ResourceForm
              modal={false}
              scope={scope}
              objectPath={`${subPath}/${encodeURIComponent(editing)}`}
              name={editing}
              title={title}
              cfg={Object.fromEntries(editHolders.map((sw, i) => [sw, editMember[i]]))}
              present={editHolders}
              onClose={() => setEditing(null)}
              onApplied={refreshed}
              notify={toast}
              doneText={`${title} ${editing}`}
            />
          )}
          <ChildMemberTables
            scope={scope}
            memberPath={`${subPath}/${encodeURIComponent(editing)}`}
            memberObjects={Object.fromEntries(editHolders.map((sw, i) => [sw, editMember[i]]))}
            present={editHolders}
            routes={memberRoutes}
          />
        </Modal>
      )}
      {deleting && (
        <DeleteFlow
          scope={scope}
          name={deleting}
          paths={Object.fromEntries(
            holders(deleting).map((sw) => [sw, `${subPath}/${encodeURIComponent(deleting)}`]),
          )}
          onClose={() => setDeleting(null)}
          onApplied={refreshed}
        />
      )}
      {quickOpen && !quickCalls && (
        <PromptModal
          open
          title={`New ${singular.toLowerCase()}`}
          label="Name"
          confirmLabel="Review"
          error={quickError}
          onSubmit={submitQuick}
          onCancel={closeQuick}
        />
      )}
      {quickCalls && quickName && (
        <ChangeFlow
          scope={scope}
          calls={quickCalls}
          warning={
            scope.kind === 'group'
              ? `${quickName} will be created on ${Object.keys(quickCalls).length} switch${Object.keys(quickCalls).length === 1 ? '' : 'es'}.`
              : undefined
          }
          onBack={() => {
            setQuickCalls(null);
            setQuickName(null);
          }}
          onClose={closeQuick}
          onApplied={() => {
            refreshed();
            closeQuick();
          }}
          notify={toast}
          doneText={`${singular} ${quickName}`}
        />
      )}
    </div>
  );
}

/** Nested tables inside a member modal, from the member's own GET schema. */
function ChildMemberTables({
  scope,
  memberPath,
  memberObjects,
  present,
  routes,
}: {
  scope: Scope;
  memberPath: string;
  memberObjects: Record<string, Obj | undefined>;
  present: string[];
  routes: Record<string, string[]>;
}) {
  const memberGet = useQuery({
    queryKey: ['spec-fields', memberPath, 'GET'],
    queryFn: () => api.fields(memberPath, 'GET'),
    staleTime: Infinity,
    retry: false,
  });
  if (memberGet.isError || !memberGet.data) return null;
  return (
    <SubTables
      scope={scope}
      basePath={memberPath}
      objects={memberObjects}
      present={present}
      routes={routes}
      item={itemSchema(memberGet.data.schema)}
      depth={DRILL_DEPTH}
      nested
    />
  );
}
