/**
 * Section edit (3A.7, design §4A + §6B): one modal for one switch or a
 * group. Form → stage (branch per switch, FanOut for groups) → dry-run
 * review per switch → apply → per-switch results (ChangeFlow). Mixed fields keep each
 * switch's value unless picked; per-switch fields take one value per member.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type StageCall } from '../../lib/api.js';
import { Alert, Button, LineDropdown, LineField, Modal, Spinner } from '../../components/ui.js';
import {
  boundsOf,
  choicesOf,
  decodeValue,
  invalidReason,
  kindOf,
  leafSchema,
  setEntries,
} from '../../lib/fieldSchema.js';
import { fillPattern, mergeValues } from '../../lib/merge.js';
import { getPath } from '../../lib/format.js';
import { fieldPath, type SectionDef } from './sections.js';
import { planCalls, type PerSwitchDraft, type PlanField, type SharedDraft } from './plan.js';
import { ChangeFlow } from './ChangeFlow.js';
import { useHeartbeat } from './Presence.js';
import { usePerSwitch, type Scope } from './scope.js';

const KEEP = '\u0000keep';
/** Set values show comma-separated in one line field. */
const setText = (v: string) => setEntries(v).join(', ');

/** Spec schema for a section's subtree (none for the interface root: hinted leaves only). */
export function useSectionSchema(ifaceId: string, section: SectionDef) {
  return useQuery({
    queryKey: ['spec-fields', 'interface', section.base],
    queryFn: () => api.fields(`/interface/${ifaceId}/${section.base}`, 'PATCH'),
    enabled: section.base !== '',
    staleTime: Infinity,
  });
}

/** Choices fed by a live collection (`/vrf`): names every present member has. */
function useLiveOptions(scope: Scope, path: string | undefined, members: string[]): string[] | null {
  const read = usePerSwitch<Record<string, unknown>>(scope, path ?? '/', { rev: 'applied', enabled: !!path });
  if (!path || read.loading) return null;
  const sets = members.map((m) => Object.keys(read.objects[m] ?? {}));
  const [first = [], ...rest] = sets;
  return first.filter((k) => rest.every((s) => s.includes(k))).sort();
}

export function SectionEdit({
  scope,
  ifaceId,
  section,
  cfg,
  present,
  preset = {},
  onClose,
  onApplied,
  notify,
}: {
  scope: Scope;
  ifaceId: string;
  section: SectionDef;
  /** Applied config per switch (interface root objects). */
  cfg: Record<string, Record<string, unknown> | undefined>;
  /** Members that have this interface. */
  present: string[];
  /** Pre-filled shared values (Align all to …). */
  preset?: SharedDraft;
  onClose: () => void;
  onApplied: () => void;
  notify: (tone: 'pass' | 'warn' | 'fail', text: string) => void;
}) {
  const ifacePath = `/interface/${ifaceId}`;
  const group = scope.kind === 'group';
  const schema = useSectionSchema(ifaceId, section);
  const liveField = section.fields.find((f) => f.optionsFrom);
  const liveOptions = useLiveOptions(scope, liveField?.optionsFrom, present);
  useHeartbeat(present, ifacePath);

  const [shared, setShared] = useState<SharedDraft>(preset);
  const [perSw, setPerSw] = useState<PerSwitchDraft>({});
  const [pattern, setPattern] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<{ calls: Record<string, StageCall[]>; unchanged: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sectionSchema = schema.data?.schema;
  const fields: Array<PlanField & { schema: Record<string, unknown> | undefined }> = section.fields.map(
    (f) => {
      const s = section.base ? leafSchema(sectionSchema, f.leaf) : undefined;
      const kind = kindOf(s, f.kind);
      const choices = f.optionsFrom ? (liveOptions ?? []) : choicesOf(s);
      return {
        path: fieldPath(section, f),
        label: f.label,
        kind,
        choices,
        perSwitch: !!f.perSwitch && group && present.length > 1,
        invalid: (t: string) => invalidReason(kind, t, s),
        schema: s,
      };
    },
  );
  const current: Record<string, Record<string, string>> = Object.fromEntries(
    present.map((sw) => [
      sw,
      Object.fromEntries(fields.map((f) => [f.path, decodeValue(f.kind, getPath(cfg[sw], f.path))])),
    ]),
  );
  const merged = (path: string) =>
    mergeValues(Object.fromEntries(present.map((sw) => [sw, current[sw]?.[path] ?? ''])));
  const isMgmt = present.some((sw) => getPath(cfg[sw], 'ip/vrf') === 'mgmt');
  const goingDown =
    shared['link/state'] === 'down' && present.some((sw) => current[sw]?.['link/state'] !== 'down');

  function review() {
    const p = planCalls(ifacePath, present, fields, current, shared, perSw);
    if (!p.ok) {
      setError(p.error);
      return;
    }
    setError(null);
    setPlan({ calls: p.calls, unchanged: p.unchanged });
  }

  const title = `${section.title} · ${ifaceId}${group ? ` · ${present.length} switch${present.length === 1 ? '' : 'es'}` : ''}`;
  const wide = fields.some((f) => f.perSwitch);

  function renderField(f: (typeof fields)[number]) {
    const m = merged(f.path);
    const mixed = m.kind === 'mixed';
    const mixedNote = mixed ? m.groups.map((g) => `${g.value || '—'} ×${g.switches.length}`).join(', ') : '';
    const same = m.kind === 'same' ? m.value : '';
    const draft = shared[f.path];

    if (f.perSwitch) {
      return (
        <div key={f.path} style={{ gridColumn: '1 / -1', marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>{f.label} · one value per switch</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <LineField
                label="Pattern"
                value={pattern[f.path] ?? ''}
                placeholder="e.g. 10.0.0.{2n-1}/31 · {sw} = switch"
                onChange={(e) => setPattern((p) => ({ ...p, [f.path]: e.target.value }))}
              />
            </div>
            <Button
              auto
              variant="secondary"
              disabled={!pattern[f.path]}
              onClick={() =>
                setPerSw((d) => ({
                  ...d,
                  [f.path]: { ...d[f.path], ...fillPattern(pattern[f.path] ?? '', present) },
                }))
              }
            >
              Fill
            </Button>
          </div>
          <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: '4px 12px' }}>
            {present.map((sw) => (
              <div
                key={sw}
                style={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', gap: 12 }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>{sw}</span>
                <span className="lf">
                  <input
                    aria-label={`${f.label} on ${sw}`}
                    value={
                      perSw[f.path]?.[sw] ??
                      (f.kind === 'set'
                        ? setText(current[sw]?.[f.path] ?? '')
                        : (current[sw]?.[f.path] ?? ''))
                    }
                    onChange={(e) =>
                      setPerSw((d) => ({ ...d, [f.path]: { ...d[f.path], [sw]: e.target.value } }))
                    }
                    placeholder={f.kind === 'set' ? 'comma-separated' : '—'}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (f.kind === 'choice' || f.kind === 'keyed') {
      const opts = [...f.choices];
      for (const g of mixed ? m.groups.map((x) => x.value) : [same])
        if (g && !opts.includes(g)) opts.unshift(g);
      const value = draft ?? (mixed ? KEEP : same);
      return (
        <LineDropdown
          key={f.path}
          label={f.label}
          value={value}
          onChange={(v) => setShared((d) => ({ ...d, [f.path]: v === KEEP ? undefined : v }))}
          options={[
            ...(mixed ? [{ value: KEEP, label: `Mixed — keep each (${mixedNote})` }] : []),
            ...(same === '' && !mixed ? [{ value: '', label: '—' }] : []),
            ...opts.map((o) => ({ value: o, label: o })),
          ]}
        />
      );
    }

    const { min, max } = boundsOf(f.schema);
    const shown = draft ?? (mixed ? '' : f.kind === 'set' ? setText(same) : same);
    return (
      <div
        key={f.path}
        style={f.kind === 'set' || f.path === 'description' ? { gridColumn: '1 / -1' } : undefined}
      >
        <LineField
          label={f.label}
          value={shown}
          inputMode={f.kind === 'number' ? 'numeric' : undefined}
          placeholder={
            mixed
              ? `Mixed — keep each (${mixedNote})`
              : f.kind === 'set'
                ? 'comma-separated'
                : min !== undefined
                  ? `${min}–${max}`
                  : undefined
          }
          error={draft !== undefined && draft !== '' ? (f.invalid(draft) ?? undefined) : undefined}
          onChange={(e) => {
            const v = e.target.value;
            setShared((d) => ({ ...d, [f.path]: mixed && v === '' ? undefined : v }));
          }}
        />
      </div>
    );
  }

  const loading = (section.base !== '' && schema.isPending) || (liveField && liveOptions === null);

  return (
    <Modal open onClose={onClose} title={title} width={wide || (group && plan) ? 600 : 460}>
      {loading ? (
        <Spinner label="Loading current values" />
      ) : plan ? (
        <ChangeFlow
          scope={scope}
          calls={plan.calls}
          unchanged={plan.unchanged}
          onBack={() => setPlan(null)}
          onClose={onClose}
          onApplied={onApplied}
          notify={notify}
          doneText={`${section.title} on ${ifaceId}`}
        />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 20 }}>
            {fields.map(renderField)}
          </div>
          {goingDown && (
            <Alert tone="warn">
              {isMgmt
                ? `${ifaceId} is a management port — taking it down cuts this app off from the switch.`
                : `Taking ${ifaceId} down stops all traffic on it.`}
            </Alert>
          )}
          {error && <Alert tone="fail">{error}</Alert>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button auto variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button auto onClick={review}>
              Review change
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
