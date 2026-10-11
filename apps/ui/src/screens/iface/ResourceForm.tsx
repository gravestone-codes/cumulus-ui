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
import { planFieldsFromSchema } from '../../lib/schema.js';
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

  function review() {
    const p = planCalls(objectPath, present, resolved, current, shared, perSw);
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

  return (
    <Modal open onClose={onClose} title={modalTitle} width={wide || (group && plan) ? 600 : 460}>
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
          doneText={doneText}
        />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 20 }}>
            {resolved.map(renderField)}
          </div>
          {warning?.(shared)}
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
