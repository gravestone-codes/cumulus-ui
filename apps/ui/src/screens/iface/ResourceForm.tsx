/**
 * ResourceForm (roadmap 2.3/R9): the one schema-driven PATCH form — modal,
 * widgets by spec kind, merged/group drafts, review, then ChangeFlow
 * (stage → dry-run → apply → results). Field lists arrive two ways: explicit
 * `fields` (domain adapters curate labels, per-switch flags, live options)
 * or schema-enumerated via `only` (zero hand-written fields; the R9 proof
 * path). Every option, bound and value still comes from the backend.
 */
import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type StageCall } from '../../lib/api.js';
import { Alert, Button, LineDropdown, LineField, Modal, Spinner } from '../../components/ui.js';
import { boundsOf, decodeValue, setEntries } from '../../lib/fieldSchema.js';
import type { FormField } from '../../lib/plan.js';
import { enableGates, planFieldsFromSchema } from '../../lib/schema.js';
import { fillPattern, mergeValues } from '../../lib/merge.js';
import { getPath } from '../../lib/format.js';
import { planCalls, type PerSwitchDraft, type SharedDraft } from '../../lib/plan.js';
import { ChangeFlow } from './ChangeFlow.js';
import { useHeartbeat } from '../../components/presence.js';
import type { Scope } from './scope.js';

const KEEP = '\u0000keep';
/** Set values show comma-separated in one line field. */
const setText = (v: string) => setEntries(v).join(', ');

export function ResourceForm({
  scope,
  objectPath,
  name,
  title,
  fields,
  only,
  labels,
  cfg,
  present,
  preset = {},
  warning,
  pending,
  modal,
  doneText,
  onClose,
  onApplied,
  notify,
}: {
  scope: Scope;
  /** NVUE path of the edited object; every PATCH goes here. */
  objectPath: string;
  /** Object name in titles and warnings. */
  name: string;
  title: string;
  /** Explicit fields (domain-curated). Mutually exclusive with `only`. */
  fields?: FormField[];
  /** Schema-enumerated leaf subset (zero hand-written fields). */
  only?: string[];
  /** Presentation label overrides for enumerated leaves. */
  labels?: Record<string, string>;
  /** Applied config per switch (object root). */
  cfg: Record<string, Record<string, unknown> | undefined>;
  /** Members that have this object. */
  present: string[];
  /** Pre-filled shared values (Align all to …). */
  preset?: SharedDraft;
  /** Domain warning from the shared draft (e.g. link going down). */
  warning?: (shared: SharedDraft) => ReactNode;
  /** Adapter fields still resolving (shows the loading state). */
  pending?: boolean;
  /** Render inline instead of in a modal (detail-tab embedding). */
  modal?: boolean;
  /** Toast text after apply. */
  doneText: string;
  onClose: () => void;
  onApplied: () => void;
  notify: (tone: 'pass' | 'warn' | 'fail', text: string) => void;
}) {
  const group = scope.kind === 'group';
  const schema = useQuery({
    queryKey: ['spec-fields', objectPath],
    queryFn: () => api.fields(objectPath, 'PATCH'),
    enabled: fields === undefined,
    staleTime: Infinity,
  });
  useHeartbeat(present, objectPath);

  const [shared, setShared] = useState<SharedDraft>(preset);
  const [perSw, setPerSw] = useState<PerSwitchDraft>({});
  const [pattern, setPattern] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<{ calls: Record<string, StageCall[]>; unchanged: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolved: FormField[] =
    fields ?? (schema.data ? planFieldsFromSchema(schema.data.schema, { only, labels }) : []);
  const current: Record<string, Record<string, string>> = Object.fromEntries(
    present.map((sw) => [
      sw,
      Object.fromEntries(resolved.map((f) => [f.path, decodeValue(f.kind, getPath(cfg[sw], f.path))])),
    ]),
  );
  const merged = (path: string) =>
    mergeValues(Object.fromEntries(present.map((sw) => [sw, current[sw]?.[path] ?? ''])));

  // Options under a feature toggle stay visible but locked while it is off
  // (draft first, then the live value, then the schema default; mixed never locks).
  const gates = enableGates(resolved.map((f) => f.path));
  const byPath = new Map(resolved.map((f) => [f.path, f]));
  function offGate(path: string): string | undefined {
    return gates.get(path)?.find((g) => {
      const m = merged(g);
      if (m.kind === 'mixed' && shared[g] === undefined) return false;
      const fallback = byPath.get(g)?.schema?.['default'];
      const v = shared[g] ?? (m.kind === 'same' && m.value ? m.value : fallback);
      return v === 'off';
    });
  }

  function review() {
    const locked = resolved.filter((f) => offGate(f.path)).map((f) => f.path);
    const live = Object.fromEntries(Object.entries(shared).filter(([k]) => !locked.includes(k)));
    const liveSw = Object.fromEntries(Object.entries(perSw).filter(([k]) => !locked.includes(k)));
    const p = planCalls(objectPath, present, resolved, current, live, liveSw);
    if (!p.ok) {
      setError(p.error);
      return;
    }
    setError(null);
    setPlan({ calls: p.calls, unchanged: p.unchanged });
  }

  const modalTitle = `${title} · ${name}${group ? ` · ${present.length} switch${present.length === 1 ? '' : 'es'}` : ''}`;
  const wide = resolved.some((f) => f.perSwitch);

  function renderField(f: FormField) {
    const gate = offGate(f.path);
    if (!gate) return renderInput(f, false);
    const toggle = byPath.get(gate)?.label ?? gate;
    return (
      <div
        key={f.path}
        className="gated"
        title={`Turn ${toggle} on to change this`}
        style={
          f.perSwitch || f.kind === 'set' || f.path === 'description' ? { gridColumn: '1 / -1' } : undefined
        }
      >
        {renderInput(f, true)}
      </div>
    );
  }

  function renderInput(f: FormField, locked: boolean) {
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
                disabled={locked}
                value={pattern[f.path] ?? ''}
                placeholder="e.g. 10.0.0.{2n-1}/31 · {sw} = switch"
                onChange={(e) => setPattern((p) => ({ ...p, [f.path]: e.target.value }))}
              />
            </div>
            <Button
              auto
              variant="secondary"
              disabled={locked || !pattern[f.path]}
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
                    disabled={locked}
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
          disabled={locked}
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
          disabled={locked}
          inputMode={f.kind === 'number' ? 'numeric' : undefined}
          placeholder={
            mixed
              ? `Mixed — keep each (${mixedNote})`
              : f.kind === 'set'
                ? 'comma-separated'
                : [min !== undefined ? `${min}–${max}` : '', ...f.choices].filter(Boolean).join(' · ') ||
                  undefined
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

  const loading = (fields === undefined && schema.isPending) || !!pending;

  const body = loading ? (
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
      doneText={doneText}
    />
  ) : (
    <>
      <div className="form-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 20 }}>
        {resolved.map(renderField)}
      </div>
      {warning?.(shared)}
      {error && <Alert tone="fail">{error}</Alert>}
      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: modal === false ? 'flex-start' : 'flex-end',
          marginTop: 16,
        }}
      >
        <Button auto variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button auto onClick={review}>
          Review change
        </Button>
      </div>
    </>
  );
  if (modal === false) return <>{body}</>;
  return (
    <Modal open onClose={onClose} title={modalTitle} width={wide || (group && plan) ? 600 : 460}>
      {body}
    </Modal>
  );
}
