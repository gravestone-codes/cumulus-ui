/**
 * Config tab (design §8B, §3A): section index on the left; picking one
 * shows only that section's card, in the existing tile layout. Values come from the applied config
 * (config-only subtrees live there); status rows from operational state.
 * Group scope shows the same cards with mixed / per-switch markers. Any
 * object with sections uses it (interfaces, bridge domains).
 */
import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Spinner, useToast } from '../../components/ui.js';
import { Card } from '../../components/cards.js';
import { ValueGrid } from '../../components/resource.js';
import { MixedValue, PerSwitchValue } from '../../components/mixed.js';
import { mergeValues } from '../../lib/merge.js';
import { displayValue, getPath } from '../../lib/format.js';
import { fieldPath, isConfigured, type SectionDef } from './sections.js';
import { SectionEdit } from './SectionEdit.js';
import { ResourceForm } from './ResourceForm.js';
import { refreshInterfaces, type Scope } from './scope.js';
import type { SharedDraft } from '../../lib/plan.js';

type Obj = Record<string, unknown> | undefined;

export function ConfigTab({
  scope,
  objectPath,
  name,
  sections,
  cfg,
  oper,
  present,
  onOpenSwitch,
  extras = [],
}: {
  scope: Scope;
  /** NVUE path of the object (`/interface/swp1`, `/bridge/domain/br_default`). */
  objectPath: string;
  /** Object name in titles, e.g. "swp1". */
  name: string;
  sections: SectionDef[];
  cfg: Record<string, Obj>;
  oper: Record<string, Obj>;
  present: string[];
  /** Open the object on one member switch (mixed-value drill-in). */
  onOpenSwitch: (sw: string) => void;
  /** Sections that draw their own card (e.g. bridge membership), listed in the same index. */
  extras?: Array<{ id: string; title: string; configured: boolean; content: ReactNode }>;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<{ section: SectionDef; preset?: SharedDraft } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const group = scope.kind === 'group';

  const valuesOf = (objs: Record<string, Obj>, path: string) =>
    Object.fromEntries(present.map((sw) => [sw, displayValue(getPath(objs[sw], path))]));

  const configured = (s: SectionDef) =>
    s.pinned || isConfigured(s.fields.flatMap((f) => Object.values(valuesOf(cfg, fieldPath(s, f)))));
  // One index over schema sections and custom ones: configured first, then available.
  const entries = [
    ...sections.map((s) => ({ id: s.id, title: s.title, configured: configured(s) })),
    ...extras.map((e) => ({ id: e.id, title: e.title, configured: e.configured })),
  ];
  const ordered = [...entries.filter((e) => e.configured), ...entries.filter((e) => !e.configured)];
  const current = ordered.find((e) => e.id === picked) ?? ordered[0];
  const shown = sections.find((s) => s.id === current?.id);
  const extra = extras.find((e) => e.id === current?.id);

  function cell(
    objs: Record<string, Obj>,
    path: string,
    label: string,
    opts: { perSwitch?: boolean; align?: (v: string) => void; running?: boolean },
  ) {
    const m = mergeValues(valuesOf(objs, path));
    // Unset in config: show what the switch runs with, marked as its default.
    if (opts.running && (m.kind === 'none' || (m.kind === 'same' && m.value === ''))) {
      const live = mergeValues(valuesOf(oper, path));
      if (live.kind === 'same' && live.value !== '') {
        return <span style={{ color: 'var(--color-muted)' }}>{live.value} · default</span>;
      }
    }
    if (m.kind === 'none') return '—';
    if (group && opts.perSwitch) {
      const groups = m.kind === 'same' ? [{ value: m.value, switches: present }] : m.groups;
      return <PerSwitchValue groups={groups} label={label} show={(v) => v || '—'} onOpen={onOpenSwitch} />;
    }
    if (m.kind === 'same') return m.value || '—';
    return <MixedValue groups={m.groups} label={label} onAlign={opts.align} onOpen={onOpenSwitch} />;
  }

  if (present.length === 0) return <Spinner label="Loading configuration" />;

  return (
    <div
      className="split-index"
      style={{ display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', gap: 20, alignItems: 'start' }}
    >
      <nav aria-label="Config sections" style={{ position: 'sticky', top: 16, display: 'grid', gap: 2 }}>
        {(['Configured', 'Available'] as const).map((heading) => {
          const list = ordered.filter((e) => e.configured === (heading === 'Configured'));
          if (list.length === 0) return null;
          return (
            <div key={heading} style={{ display: 'grid', gap: 2 }}>
              <span style={indexHeading}>{heading}</span>
              {list.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="index-link"
                  aria-current={s.id === current?.id}
                  onClick={() => setPicked(s.id)}
                >
                  {s.title}
                </button>
              ))}
            </div>
          );
        })}
      </nav>
      <div style={{ display: 'grid', gap: 12 }}>
        {extra?.content}
        {(shown ? [shown] : []).map((s) => {
          const items = [
            ...s.fields.map((f) => ({
              label: f.label,
              value: cell(cfg, fieldPath(s, f), f.label, {
                perSwitch: f.perSwitch,
                running: true,
                align: (v) => setEditing({ section: s, preset: { [fieldPath(s, f)]: v } }),
              }),
            })),
            ...(s.status ?? []).map((r) => ({
              label: r.label,
              value: cell(oper, r.leaf, r.label, { perSwitch: r.perSwitch }),
            })),
          ];
          return (
            <div key={s.id}>
              <Card
                title={s.title}
                hint={configured(s) ? undefined : 'Not configured'}
                actions={
                  <Button auto variant="secondary" onClick={() => setEditing({ section: s })}>
                    {configured(s) ? 'Edit' : 'Configure'}
                  </Button>
                }
              >
                <ValueGrid items={items} />
              </Card>
            </div>
          );
        })}
      </div>
      {editing && editing.section.id === 'general' ? (
        // TODO promote: route every section through ResourceForm (merge-back: M2).
        // General (one description field) proves the schema-enumerated path end to end.
        <ResourceForm
          scope={scope}
          objectPath={objectPath}
          name={name}
          title={editing.section.title}
          only={['description']}
          cfg={cfg}
          present={present}
          preset={editing.preset}
          onClose={() => setEditing(null)}
          onApplied={() => refreshInterfaces(queryClient)}
          notify={toast}
          doneText={`${editing.section.title} on ${name}`}
        />
      ) : (
        editing && (
          <SectionEdit
            scope={scope}
            objectPath={objectPath}
            name={name}
            section={editing.section}
            cfg={cfg}
            present={present}
            preset={editing.preset}
            onClose={() => setEditing(null)}
            onApplied={() => refreshInterfaces(queryClient)}
            notify={toast}
          />
        )
      )}
    </div>
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
