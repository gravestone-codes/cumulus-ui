/**
 * Config tab (design §8B, §3A): section index on the left; picking one
 * shows only that section's card, in the existing tile layout. Values come from the applied config
 * (config-only subtrees live there); status rows from operational state.
 * Group scope shows the same cards with mixed / per-switch markers.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Spinner, useToast } from '../../components/ui.js';
import { Card } from '../../components/cards.js';
import { ValueGrid } from '../../components/resource.js';
import { MixedValue, PerSwitchValue } from '../../components/mixed.js';
import { mergeValues } from '../../lib/merge.js';
import { getPath } from '../../lib/format.js';
import { fieldPath, isConfigured, sectionsFor, type SectionDef } from './sections.js';
import { SectionEdit } from './SectionEdit.js';
import { refreshInterfaces, type Scope } from './scope.js';
import type { SharedDraft } from './plan.js';

type Obj = Record<string, unknown> | undefined;

/** Any NVUE value as display text: tag/set objects → their keys, scalars as-is. */
export function displayValue(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw === 'object')
    return Object.keys(raw as object)
      .sort()
      .join(', ');
  return String(raw);
}

export function ConfigTab({
  scope,
  ifaceId,
  cfg,
  oper,
  present,
}: {
  scope: Scope;
  ifaceId: string;
  cfg: Record<string, Obj>;
  oper: Record<string, Obj>;
  present: string[];
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<{ section: SectionDef; preset?: SharedDraft } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const group = scope.kind === 'group';
  const type = present.map((sw) => displayValue(getPath(cfg[sw] ?? oper[sw], 'type'))).find(Boolean);

  const valuesOf = (objs: Record<string, Obj>, path: string) =>
    Object.fromEntries(present.map((sw) => [sw, displayValue(getPath(objs[sw], path))]));

  const sections = sectionsFor(type);
  const configured = (s: SectionDef) =>
    s.pinned || isConfigured(s.fields.flatMap((f) => Object.values(valuesOf(cfg, fieldPath(s, f)))));
  const ordered = [...sections.filter(configured), ...sections.filter((s) => !configured(s))];
  const shown = ordered.find((s) => s.id === picked) ?? ordered[0];

  const openSwitch = (sw: string) =>
    navigate(`/switches/${encodeURIComponent(sw)}/interfaces/${encodeURIComponent(ifaceId)}`);

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
      return <PerSwitchValue groups={groups} label={label} show={(v) => v || '—'} onOpen={openSwitch} />;
    }
    if (m.kind === 'same') return m.value || '—';
    return <MixedValue groups={m.groups} label={label} onAlign={opts.align} onOpen={openSwitch} />;
  }

  if (present.length === 0) return <Spinner label="Loading configuration" />;

  return (
    <div
      style={{ display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', gap: 20, alignItems: 'start' }}
    >
      <nav aria-label="Config sections" style={{ position: 'sticky', top: 16, display: 'grid', gap: 2 }}>
        {(['Configured', 'Available'] as const).map((heading) => {
          const list = ordered.filter((s) => configured(s) === (heading === 'Configured'));
          if (list.length === 0) return null;
          return (
            <div key={heading} style={{ display: 'grid', gap: 2 }}>
              <span style={indexHeading}>{heading}</span>
              {list.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="index-link"
                  aria-current={s.id === shown?.id}
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
      {editing && (
        <SectionEdit
          scope={scope}
          ifaceId={ifaceId}
          section={editing.section}
          cfg={cfg}
          present={present}
          preset={editing.preset}
          onClose={() => setEditing(null)}
          onApplied={() => refreshInterfaces(queryClient)}
          notify={toast}
        />
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
