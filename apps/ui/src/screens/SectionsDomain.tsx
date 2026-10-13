/**
 * Container domain screen (`/router`, `/service`, `/system`): one NVUE
 * object whose children are sections (bgp, ospf, pim…; syslog, ntp, snmp…).
 * Same layout as an interface's Config tab — a Configured / Available index
 * on the left, the picked section's card on the right. Sections come from
 * the schema (backend), configured state from the applied read; values merge
 * per member in group scope. Edit is the schema-enumerated ResourceForm on
 * the section's own path; sections with a deeper screen link to it.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Breadcrumb, Button, Spinner, useToast } from '../components/ui.js';
import { Card } from '../components/cards.js';
import { ReadError, ValueGrid } from '../components/resource.js';
import { MixedValue } from '../components/mixed.js';
import { mergeValues } from '../lib/merge.js';
import { displayValue, getPath } from '../lib/format.js';
import { sectionDomains, type DomainDef } from '../lib/domains.js';
import { itemSchema, leafLabel, scalarLeaves, useSchemaSections } from '../lib/schema.js';
import { api } from '../lib/api.js';
import { SectionActions, actionPaths } from '../components/SectionActions.js';
import { SubCollections } from '../components/SubCollections.js';
import { ScopeShell } from './iface/ScopeShell.js';
import { ResourceForm } from './iface/ResourceForm.js';
import { refreshInterfaces, scopeBase, usePerSwitch, type Scope } from './iface/scope.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The container's own top-level settings (`/system` hostname, timezone…) as a pseudo-section. */
const GENERAL = 'general';

export function SectionsDomain({ def, scope }: { def: DomainDef; scope: Scope }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState('');
  const base = scopeBase(scope);
  const group = scope.kind === 'group';
  // What `nv config show` prints: the root without defaults (NVUE honours filled only at `/`),
  // so a section counts as configured only when something in it differs from default.
  const root = usePerSwitch<Obj>(scope, '/', { rev: def.rev ?? 'applied', filled: false });
  const key = def.collection.slice(1);
  const read = {
    ...root,
    objects: Object.fromEntries(
      root.members.map((sw) => {
        const v = getPath(root.objects[sw], key);
        return [sw, isObj(v) ? v : undefined];
      }),
    ) as Record<string, Obj | undefined>,
  };
  const schema = useSchemaSections(def.item);
  // A container nobody configured reads as absent; it is still there to configure.
  const present = read.members.filter((m) => !read.errors[m]);

  const general = schema.leaves.filter((l) => !l.path.includes('/'));
  const configuredKeys = new Set(present.flatMap((sw) => Object.keys(read.objects[sw] ?? {})));
  const ids = [
    ...(general.length > 0 ? [GENERAL] : []),
    ...schema.sections,
    // Configured keys the schema does not list still show (never hide live config).
    ...[...configuredKeys].filter(
      (k) => !schema.sections.includes(k) && !general.some((l) => l.path === k) && !k.startsWith('@'),
    ),
  ];
  const sectionObj = (sw: string, id: string): Obj | undefined => {
    const o = read.objects[sw];
    if (id === GENERAL) return o;
    const v = getPath(o, id);
    return isObj(v) ? v : undefined;
  };
  const configured = (id: string) =>
    id === GENERAL
      ? general.some((l) => present.some((sw) => displayValue(getPath(read.objects[sw], l.path)) !== ''))
      : configuredKeys.has(id);
  const titleOf = (id: string) => (id === GENERAL ? 'General' : leafLabel(id));
  const ordered = [...ids.filter(configured), ...ids.filter((id) => !configured(id))];

  // Dead sections (hostname, timezone, cpu…): empty `{}` in the spec — no
  // PATCH leaves, no POST actions, no row maps. They stay only while holding
  // live config; empty and unwritable ones leave the index instead of
  // dead-ending on "Nothing set" with no Configure.
  const containerFields = useQuery({
    queryKey: ['spec-fields', def.collection, 'PATCH'],
    queryFn: () => api.fields(def.collection, 'PATCH'),
    staleTime: Infinity,
    retry: false,
  });
  const manifest = useQuery({ queryKey: ['manifest'], queryFn: () => api.manifest(), staleTime: 300_000 });
  const containerItem = containerFields.data ? itemSchema(containerFields.data.schema) : null;
  const containerProps =
    containerItem && isObj(containerItem.properties)
      ? (containerItem.properties as Record<string, unknown>)
      : null;
  const sliceLeaves = (id: string) =>
    schema.leaves.filter((l) => l.path.startsWith(`${id}/`)).map((l) => l.path.slice(id.length + 1));
  const hasSubMaps = (id: string) => {
    const prop = containerProps?.[id];
    if (!isObj(prop)) return false;
    if (isObj(prop.additionalProperties)) return true;
    if (!isObj(prop.properties)) return false;
    return Object.values(prop.properties as Record<string, unknown>).some(
      (k) => isObj(k) && isObj((k as Obj).additionalProperties),
    );
  };
  const sectionRef = (id: string) => `${def.collection}/${id}`;
  // Conservative while the manifest is still loading: sections only leave
  // once known dead, never on unknown.
  const hideable = (id: string) =>
    id !== GENERAL &&
    !configured(id) &&
    sectionDomains(def, id).length === 0 &&
    sliceLeaves(id).length === 0 &&
    containerProps !== null &&
    !hasSubMaps(id) &&
    !manifest.isPending &&
    actionPaths(manifest.data?.routes ?? {}, sectionRef(id)).length === 0;
  const visible = ordered.filter((id) => !hideable(id));
  const current = visible.find((id) => id === params.get('section')) ?? visible[0];
  // TODO promote: SectionIndex (scrollable + filterable split-index nav) shared with
  // iface/ConfigTab (merge-back: next domain slice touching either).
  const q = filter.trim().toLowerCase();
  const matches = (id: string) => q === '' || titleOf(id).toLowerCase().includes(q);

  // The container slice only sees depth-1 scalars, so deep-but-scalar settings
  // (aaa/*, sflow/*, telemetry/*…) never offered Configure. The section's own
  // PATCH schema enumerates them all; `@action` leaves are operations (POST),
  // never PATCH bodies, so they stay out of display and forms alike.
  const sectionPath = current && current !== GENERAL ? `${def.collection}/${current}` : null;
  const sectionFields = useQuery({
    queryKey: ['spec-fields', sectionPath ?? '', 'PATCH'],
    queryFn: () => api.fields(sectionPath ?? '', 'PATCH'),
    enabled: !!sectionPath,
    staleTime: Infinity,
    retry: false,
  });
  const sectionItem = sectionFields.data ? itemSchema(sectionFields.data.schema) : null;
  const sectionLeaves = sectionItem
    ? scalarLeaves(sectionItem, '', 0, 6).filter((l) => !l.path.split('/').some((seg) => seg.startsWith('@')))
    : null;

  // Leaves of the picked section, relative to its own path.
  const leaves =
    !current || current === GENERAL
      ? general
      : (sectionLeaves ??
        schema.leaves
          .filter((l) => l.path.startsWith(`${current}/`))
          .map((l) => ({ ...l, path: l.path.slice(current.length + 1) })));
  const valuesAt = (path: string) =>
    Object.fromEntries(present.map((sw) => [sw, displayValue(getPath(sectionObj(sw, current ?? ''), path))]));
  const set = leaves.filter((l) => Object.values(valuesAt(l.path)).some((v) => v !== ''));
  // Configured children the scalar leaves do not cover (maps such as syslog servers): list their keys.
  const covered = (k: string) => leaves.some((l) => l.path === k || l.path.startsWith(`${k}/`));
  const nested = current
    ? [
        ...new Set(
          present.flatMap((sw) =>
            Object.keys(sectionObj(sw, current) ?? {}).filter(
              (k) => !covered(k) && !k.startsWith('@') && !(current === GENERAL && ids.includes(k)),
            ),
          ),
        ),
      ]
    : [];

  const cell = (values: Record<string, string>, label: string) => {
    const m = mergeValues(values);
    if (m.kind === 'none') return '—';
    if (m.kind === 'same') return m.value || '—';
    return group ? (
      <MixedValue
        groups={m.groups}
        label={label}
        onOpen={(sw) => navigate(`/switches/${encodeURIComponent(sw)}/${def.key}?section=${current}`)}
      />
    ) : (
      '—'
    );
  };
  const items = [
    ...set.map((l) => ({ label: l.label, value: cell(valuesAt(l.path), l.label) })),
    ...nested.map((k) => {
      const label = leafLabel(k);
      return {
        label,
        value: cell(
          Object.fromEntries(
            present.map((sw) => {
              const v = getPath(sectionObj(sw, current ?? ''), k);
              return [sw, isObj(v) ? Object.keys(v).join(', ') || 'on' : displayValue(v)];
            }),
          ),
          label,
        ),
      };
    }),
  ];
  // Edit offers every scalar leaf the section's PATCH schema enumerates (what
  // is set plus what is available); `@action` operations stay out (POST-only).
  const editLeaves = [
    ...new Set(
      [...set.map((l) => l.path), ...leaves.map((l) => l.path)].filter(
        (p) => !p.split('/').some((seg) => seg.startsWith('@')),
      ),
    ),
  ];
  const objectPath = current === GENERAL ? def.collection : `${def.collection}/${current}`;
  const linkDefs = current && current !== GENERAL ? sectionDomains(def, current) : [];

  return (
    <ScopeShell scope={scope} active={`/${def.key}`}>
      <Breadcrumb trail={[{ label: scope.id, to: base }, { label: def.label }]} onNav={navigate} />
      <div className="list-head">
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{def.label}</h1>
      </div>
      {read.error ? (
        <ReadError switchId={read.members[0] ?? ''} message={read.error.message} onFixed={read.refetch} />
      ) : read.loading || schema.loading ? (
        <Spinner label={`Loading ${def.label.toLowerCase()}`} />
      ) : (
        <div
          className="split-index"
          style={{
            display: 'grid',
            gridTemplateColumns: '200px minmax(0, 1fr)',
            gap: 20,
            alignItems: 'start',
          }}
        >
          <nav
            aria-label={`${def.label} sections`}
            style={{
              position: 'sticky',
              top: 16,
              display: 'grid',
              gap: 2,
              alignContent: 'start',
              maxHeight: 'calc(100dvh - 140px)',
              overflowY: 'auto',
            }}
          >
            <input
              type="search"
              aria-label={`Filter ${def.label} sections`}
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="select-search"
              style={{ position: 'sticky', top: 0, background: 'var(--color-bg)', zIndex: 1 }}
            />
            {(['Configured', 'Available'] as const).map((heading) => {
              const list = visible.filter(
                (id) => configured(id) === (heading === 'Configured') && matches(id),
              );
              if (list.length === 0) return null;
              return (
                <div key={heading} style={{ display: 'grid', gap: 2 }}>
                  <span style={indexHeading}>{heading}</span>
                  {list.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="index-link"
                      aria-current={id === current}
                      ref={id === current ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
                      onClick={() => {
                        setEditing(false);
                        setParams({ section: id }, { replace: true });
                      }}
                    >
                      {titleOf(id)}
                    </button>
                  ))}
                </div>
              );
            })}
            {q !== '' && !visible.some(matches) && (
              <span style={{ fontSize: 13, color: 'var(--color-muted)', padding: '4px 10px' }}>
                No sections match “{filter.trim()}”.
              </span>
            )}
          </nav>
          {current && (
            <Card
              title={titleOf(current)}
              hint={configured(current) ? undefined : 'Not configured'}
              actions={
                <span style={{ display: 'inline-flex', gap: 8 }}>
                  {linkDefs.map((d) => (
                    <Button key={d.key} auto variant="secondary" onClick={() => navigate(`${base}/${d.key}`)}>
                      Open {d.label}
                    </Button>
                  ))}
                  {editLeaves.length > 0 && (
                    <Button auto variant="secondary" onClick={() => setEditing(true)}>
                      {configured(current) ? 'Edit' : 'Configure'}
                    </Button>
                  )}
                  <SectionActions
                    scope={scope}
                    objectPath={objectPath}
                    members={present}
                    exact={current === GENERAL}
                  />
                </span>
              }
            >
              {items.length > 0 ? (
                <ValueGrid items={items} />
              ) : (
                <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>
                  Nothing set — the switch runs this section on its defaults.
                </p>
              )}
              {/* General is the container's own scalars; its maps and objects are sections. */}
              {current !== GENERAL && (
                <SubCollections
                  scope={scope}
                  parentPath={objectPath}
                  objects={Object.fromEntries(present.map((sw) => [sw, sectionObj(sw, current)]))}
                  present={present}
                />
              )}
            </Card>
          )}
        </div>
      )}
      {editing && current && (
        <ResourceForm
          scope={scope}
          objectPath={objectPath}
          name={def.label}
          title={titleOf(current)}
          only={editLeaves}
          cfg={Object.fromEntries(present.map((sw) => [sw, sectionObj(sw, current)]))}
          present={present}
          onClose={() => setEditing(false)}
          onApplied={() => refreshInterfaces(queryClient)}
          notify={toast}
          doneText={`${def.label} ${titleOf(current)}`}
        />
      )}
    </ScopeShell>
  );
}

const indexHeading: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--color-muted)',
  padding: '10px 10px 4px',
};
