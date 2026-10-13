import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, type MemberResult } from '../lib/api.js';
import { leafLabel } from '../lib/schema.js';
import {
  choicesOf,
  encodeValue,
  invalidReason,
  kindOf,
  leafSchema,
  mergeBodies,
  nest,
  type FieldKind,
} from '../lib/fieldSchema.js';
import { itemSchema, scalarLeaves } from '../lib/schema.js';
import { Alert, Button, LineDropdown, LineField, Modal, RowMenu, useToast } from './ui.js';

/** Whether a POST path falls in the §6.6 class (prefixes served by the manifest). */
export function isDangerousPath(prefixes: string[], path: string): boolean {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
}

/** Short label for an action path (`/system/config/files` → `Files`). */
function actionLabel(path: string): string {
  const last = path.split('/').pop() ?? path;
  return leafLabel(last);
}

/** Output-only leaves of NVUE's uniform `@action` envelope (never action inputs). */
const ACTION_OUTPUTS = new Set(['status', 'percentage', 'detail', 'http-status', 'issue']);

/**
 * Runnable params of a POST body schema: `@action` inputs (`@fetch/state`,
 * `@export/parameters/force`…) stay — they ARE the action — while the
 * envelope's output leaves (`status`, `percentage`, …) stay out.
 */
export function actionParams(schema: unknown): string[] {
  const item = itemSchema(schema);
  if (!item) return [];
  return scalarLeaves(item, '', 0, 4)
    .map((l) => l.path)
    .filter((p) => {
      const segs = p.split('/');
      const at = segs.findIndex((s) => s.startsWith('@'));
      if (at === -1) return true;
      const rest = segs.slice(at + 1);
      const head = rest[0];
      // `@x` alone, `@x/state`, `@x/timeout`, `@x/parameters/…` are inputs.
      if (rest.length === 0 || head === 'state' || head === 'timeout') return true;
      if (head === 'parameters') return true;
      // `@x/type` is the action's own type tag (output); anything else shaped
      // like the envelope (`status`, `percentage`, …) is output too.
      if (rest.length === 1 && (head === 'type' || (head !== undefined && ACTION_OUTPUTS.has(head))))
        return false;
      return !rest.some((s) => ACTION_OUTPUTS.has(s));
    });
}

/** One action input as the dialog renders it. */
export interface ActionField {
  path: string;
  label: string;
  kind: FieldKind;
  choices: string[];
  schema: ReturnType<typeof leafSchema>;
}

/** Pre-armed values: a `…/state` trigger offering `start` defaults to it until the user picks otherwise. */
export function armedDefaults(fields: ActionField[]): Record<string, string> {
  return Object.fromEntries(
    fields
      .filter((f) => f.path.endsWith('/state') && f.choices.includes('start'))
      .map((f) => [f.path, 'start']),
  );
}

/**
 * POST body from the dialog values. Invalid values come back as per-field
 * errors (Run stays disabled) — never silently dropped from the body.
 */
export function actionBody(
  fields: ActionField[],
  values: Record<string, string>,
): { body: Record<string, unknown>; errors: Record<string, string> } {
  let body: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.path] ?? '').trim();
    if (v === '') continue;
    const bad = invalidReason(f.kind, v, f.schema);
    if (bad) {
      errors[f.path] = bad;
      continue;
    }
    body = mergeBodies(body, nest(f.path, encodeValue(f.kind, v, f.choices)));
  }
  return { body, errors };
}

/**
 * Concrete POST operations at or under one object path, sorted. Templated
 * (`{id}`) members belong to their row's detail screen, never a section card.
 * `exact` keeps only POSTs on the path itself (a container's General card).
 */
export function actionPaths(routes: Record<string, string[]>, objectPath: string, exact = false): string[] {
  return Object.entries(routes)
    .filter(
      ([path, methods]) =>
        methods.includes('post') &&
        (path === objectPath || (!exact && path.startsWith(`${objectPath}/`))) &&
        !path.includes('{'),
    )
    .map(([path]) => path)
    .sort();
}

/**
 * POST operations on and below one member row (BGP soft/clear per neighbor,
 * fetch per file…): manifest templates matching the row's path whose remaining
 * segments are literal (`soft/in`), concretized with the row's own path. A
 * POST directly on a templated row (per-file fetch) counts too; a static path
 * stays with SectionActions. Templates needing a deeper id stay out (no row
 * to address them with).
 */
export function memberActionPaths(routes: Record<string, string[]>, memberPath: string): string[] {
  const base = memberPath.split('/');
  const out: string[] = [];
  for (const [tmpl, methods] of Object.entries(routes)) {
    if (!methods.includes('post')) continue;
    const ts = tmpl.split('/');
    if (ts.length < base.length) continue;
    if (!ts.slice(0, base.length).every((s, i) => s.startsWith('{') || s === base[i])) continue;
    const rest = ts.slice(base.length);
    if (rest.some((s) => s.startsWith('{'))) continue;
    if (rest.length === 0 && !tmpl.includes('{')) continue;
    out.push([...base, ...rest].join('/'));
  }
  return [...new Set(out)].sort();
}

/**
 * Every concrete POST operation at or under one NVUE object path, run through
 * ActionRunner (confirm → params → run → per-switch results). Discovers from
 * the backend manifest, so new spec operations appear with zero UI changes.
 * Member-templated actions (`{id}`) belong to their row's detail screen.
 */
export function SectionActions({
  scope,
  objectPath,
  members,
  exact,
}: {
  scope: { kind: 'switch' | 'group'; id: string };
  /** Section object path (e.g. `/system/packages`); GENERAL passes the container with `exact`. */
  objectPath: string;
  /** Switches that hold the object (group member picker). */
  members: string[];
  /** Only POSTs on `objectPath` itself, none below (sections own their subtrees). */
  exact?: boolean;
}) {
  const manifest = useQuery({ queryKey: ['manifest'], queryFn: () => api.manifest(), staleTime: 300_000 });
  const [chosen, setChosen] = useState<string | null>(null);
  const routes = manifest.data?.routes ?? {};
  const actions = actionPaths(routes, objectPath, exact);
  if (!manifest.data || actions.length === 0) return null;
  return (
    <>
      <RowMenu
        label="Section actions"
        items={actions.map((path) => ({ label: actionLabel(path), onClick: () => setChosen(path) }))}
      />
      {chosen && manifest.data && (
        <ActionModal
          key={chosen}
          scope={scope}
          path={chosen}
          dangerous={isDangerousPath(manifest.data.dangerous, chosen)}
          members={members}
          onClose={() => setChosen(null)}
        />
      )}
    </>
  );
}

/**
 * POST operations on one member row (its own concrete path): the same
 * ActionRunner modal as sections, fed with the row's templated actions.
 * Renders nothing when the member has no runnable actions.
 */
export function MemberActions({
  scope,
  memberPath,
  members,
}: {
  scope: { kind: 'switch' | 'group'; id: string };
  /** Concrete member path (e.g. `/vrf/default/router/bgp/neighbor/swp29`). */
  memberPath: string;
  /** Switches holding the row. */
  members: string[];
}) {
  const manifest = useQuery({ queryKey: ['manifest'], queryFn: () => api.manifest(), staleTime: 300_000 });
  const [chosen, setChosen] = useState<string | null>(null);
  const actions = memberActionPaths(manifest.data?.routes ?? {}, memberPath);
  if (!manifest.data || actions.length === 0) return null;
  return (
    <>
      <RowMenu
        label="Row actions"
        items={actions.map((path) => ({ label: actionLabel(path), onClick: () => setChosen(path) }))}
      />
      {chosen && manifest.data && (
        <ActionModal
          key={chosen}
          scope={scope}
          path={chosen}
          dangerous={isDangerousPath(manifest.data.dangerous, chosen)}
          members={members}
          onClose={() => setChosen(null)}
        />
      )}
    </>
  );
}

function ActionModal({
  scope,
  path,
  dangerous,
  members,
  onClose,
}: {
  scope: { kind: 'switch' | 'group'; id: string };
  path: string;
  /** §6.6 class: demand the typed action name before running. */
  dangerous: boolean;
  members: string[];
  onClose: () => void;
}) {
  const toast = useToast();
  const group = scope.kind === 'group';
  const [picked, setPicked] = useState<string[]>(members);
  const [values, setValues] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<MemberResult[] | null>(null);
  const [single, setSingle] = useState<{ jobId: string | null; finalState: string | null } | null>(null);
  const params = useQuery({
    queryKey: ['spec-fields', path, 'POST'],
    queryFn: () => api.fields(path, 'POST'),
    staleTime: Infinity,
    retry: false,
  });
  const fields: ActionField[] = actionParams(params.data?.schema)
    .map((leaf) => {
      const s = leafSchema(params.data?.schema, leaf);
      const kind = kindOf(s);
      return { path: leaf, label: leafLabel(leaf, s), kind, choices: choicesOf(s), schema: s };
    })
    .filter((f) => f.kind === 'text' || f.kind === 'number' || f.kind === 'choice' || f.kind === 'keyed');
  // The trigger defaults to `start`: opening the dialog pre-arms the action,
  // the user only reviews params and confirms. Values the user touched win.
  const current = { ...armedDefaults(fields), ...values };
  const { body, errors } = actionBody(fields, current);
  const short = actionLabel(path);
  const ready = (!dangerous || typed === short) && Object.keys(errors).length === 0;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (!group) {
        const res = await api.runAction(scope.id, { path, body });
        setSingle(res);
        toast(res.finalState === 'success' ? 'pass' : 'warn', `${short}: ${res.finalState ?? 'unknown'}.`);
      } else {
        const res = await api.groupAction(scope.id, { path, body, members: picked });
        setResults(res.results);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed.');
    }
    setBusy(false);
  }

  return (
    <Modal open onClose={onClose} title={`${short} · ${path}`}>
      <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '0 0 12px' }}>
        POST {path}
        {group ? ` · ${picked.length} switch${picked.length === 1 ? '' : 'es'}` : ` · ${scope.id}`}
      </p>
      {group && !results && (
        <div role="group" aria-label="Switches" style={{ display: 'grid', gap: 2, marginBottom: 12 }}>
          {members.map((sw) => (
            <label key={sw} className="check-row">
              <input
                type="checkbox"
                checked={picked.includes(sw)}
                onChange={(e) =>
                  setPicked((p) => (e.target.checked ? [...p, sw] : p.filter((x) => x !== sw)))
                }
              />
              {sw}
            </label>
          ))}
        </div>
      )}
      {params.isPending ? (
        <p style={{ fontSize: 13, color: 'var(--color-muted)' }}>Loading parameters…</p>
      ) : fields.length > 0 && !results && !single ? (
        <div style={{ display: 'grid', gap: 4, marginBottom: 12 }}>
          {fields.map((f) =>
            f.kind === 'choice' || f.kind === 'keyed' ? (
              <LineDropdown
                key={f.path}
                label={f.label}
                error={errors[f.path]}
                options={[{ value: '', label: '—' }, ...f.choices.map((c) => ({ value: c, label: c }))]}
                value={current[f.path] ?? ''}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.path]: v }))}
              />
            ) : (
              <LineField
                key={f.path}
                label={f.label}
                error={errors[f.path]}
                value={current[f.path] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.path]: e.target.value }))}
              />
            ),
          )}
        </div>
      ) : null}
      {dangerous && !results && !single && (
        <LineField
          label={`Type ${short} to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      )}
      {error && <Alert tone="fail">{error}</Alert>}
      {single && (
        <Alert tone={single.finalState === 'success' ? 'pass' : 'warn'}>
          {`Job ${single.jobId ?? '—'} · ${single.finalState ?? 'unknown'}`}
        </Alert>
      )}
      {results && (
        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          {results.map((r) => (
            <Alert key={r.switchId} tone={r.ok ? 'pass' : 'fail'}>
              {`${r.switchId}: ${r.ok ? (r.finalState ?? 'done') : (r.error ?? 'failed')}`}
            </Alert>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        {results || single ? (
          <Button auto onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button auto variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              auto
              variant="danger"
              onClick={run}
              disabled={busy || !ready || (group && picked.length === 0)}
            >
              {busy ? 'Running…' : `Run ${short}`}
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
