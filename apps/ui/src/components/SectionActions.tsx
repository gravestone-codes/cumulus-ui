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
} from '../lib/fieldSchema.js';
import { itemSchema, scalarLeaves } from '../lib/schema.js';
import { Alert, Button, LineDropdown, LineField, Modal, RowMenu, useToast } from './ui.js';

/** POST prefixes whose blast radius needs a typed confirmation (mirrors the backend danger gate). */
const DANGEROUS_PREFIXES = [
  '/system/factory-default',
  '/system/image',
  '/system/packages',
  '/system/aaa',
  '/system/security',
];

/** Short label for an action path (`/system/config/files` → `Files`). */
function actionLabel(path: string): string {
  const last = path.split('/').pop() ?? path;
  return leafLabel(last);
}

/**
 * Concrete POST operations at or under one object path, sorted. Templated
 * (`{id}`) members belong to their row's detail screen, never a section card.
 */
export function actionPaths(routes: Record<string, string[]>, objectPath: string): string[] {
  return Object.entries(routes)
    .filter(
      ([path, methods]) =>
        methods.includes('post') &&
        (path === objectPath || path.startsWith(`${objectPath}/`)) &&
        !path.includes('{'),
    )
    .map(([path]) => path)
    .sort();
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
}: {
  scope: { kind: 'switch' | 'group'; id: string };
  /** Section object path (e.g. `/system/packages`); GENERAL passes the container. */
  objectPath: string;
  /** Switches that hold the object (group member picker). */
  members: string[];
}) {
  const manifest = useQuery({ queryKey: ['manifest'], queryFn: () => api.manifest(), staleTime: 300_000 });
  const [chosen, setChosen] = useState<string | null>(null);
  const routes = manifest.data?.routes ?? {};
  const actions = actionPaths(routes, objectPath);
  if (!manifest.data || actions.length === 0) return null;
  return (
    <>
      <RowMenu
        label="Section actions"
        items={actions.map((path) => ({ label: actionLabel(path), onClick: () => setChosen(path) }))}
      />
      {chosen && (
        <ActionModal
          key={chosen}
          scope={scope}
          path={chosen}
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
  members,
  onClose,
}: {
  scope: { kind: 'switch' | 'group'; id: string };
  path: string;
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
  const item = params.data ? itemSchema(params.data.schema) : null;
  const fields = (item ? scalarLeaves(item, '', 0, 3) : [])
    .filter((l) => !l.path.split('/').some((seg) => seg.startsWith('@')))
    .map((l) => {
      const s = leafSchema(params.data?.schema, l.path);
      const kind = kindOf(s);
      return { path: l.path, label: leafLabel(l.path, s), kind, choices: choicesOf(s), schema: s };
    })
    .filter((f) => f.kind === 'text' || f.kind === 'number' || f.kind === 'choice' || f.kind === 'keyed');
  const dangerous = DANGEROUS_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  const short = actionLabel(path);
  const ready = !dangerous || typed === short;

  function body(): Record<string, unknown> {
    let out: Record<string, unknown> = {};
    for (const f of fields) {
      const v = (values[f.path] ?? '').trim();
      if (v === '') continue;
      const bad = invalidReason(f.kind, v, f.schema);
      if (bad) continue;
      out = mergeBodies(out, nest(f.path, encodeValue(f.kind, v, f.choices)));
    }
    return out;
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      if (!group) {
        const res = await api.runAction(scope.id, { path, body: body() });
        setSingle(res);
        toast('pass', `${short}: ${res.finalState ?? 'done'}.`);
      } else {
        const res = await api.groupAction(scope.id, { path, body: body(), members: picked });
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
                options={[{ value: '', label: '—' }, ...f.choices.map((c) => ({ value: c, label: c }))]}
                value={values[f.path] ?? ''}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.path]: v }))}
              />
            ) : (
              <LineField
                key={f.path}
                label={f.label}
                value={values[f.path] ?? ''}
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
