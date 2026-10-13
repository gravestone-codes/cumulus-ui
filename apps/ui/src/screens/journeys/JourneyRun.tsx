/**
 * One journey run: the step rail and the current step. Input steps post
 * values (validated server-side); change steps show the exact writes, then
 * ChangeFlow stages, dry-runs and applies them like any edit; every check is
 * a server-side read — the step moves on only when the switch confirms it.
 * Finished steps stay reviewable with their evidence.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  ApiError,
  type JourneyDef,
  type JourneyEvidence,
  type JourneyRun as Run,
  type JourneyStepDef,
} from '../../lib/api.js';
import { callCommands, perMember, railOf } from '../../lib/journeys.js';
import { timeAgo } from '../../lib/format.js';
import {
  Alert,
  Badge,
  Breadcrumb,
  Button,
  Confirm,
  LineDropdown,
  LineField,
  Modal,
  Spinner,
  useToast,
} from '../../components/ui.js';
import { Card } from '../../components/cards.js';
import { CodeBlock } from '../../components/CodeBlock.js';
import { JourneyRail } from '../../components/JourneyRail.js';
import { ChangeFlow } from '../iface/ChangeFlow.js';
import { ScopeShell } from '../iface/ScopeShell.js';
import { refreshInterfaces, scopeBase, type Scope } from '../iface/scope.js';
import { RunBadge } from './Journeys.js';

type StepOp = { op: 'submit' | 'verify' | 'skip'; values?: Record<string, string> };

export function JourneyRun() {
  const { switchId, groupId, runId = '' } = useParams();
  const scope: Scope = groupId ? { kind: 'group', id: groupId } : { kind: 'switch', id: switchId ?? '' };
  const base = scopeBase(scope);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const [abandoning, setAbandoning] = useState(false);
  const run = useQuery({
    queryKey: ['journey-run', runId],
    queryFn: () => api.journeyRun(runId),
    retry: false,
  });
  const catalog = useQuery({
    queryKey: ['journeys', scope.kind, scope.id],
    queryFn: () => api.journeys(scope),
    retry: false,
  });
  const def = catalog.data?.journeys.find((j) => j.key === run.data?.journey);

  function accept(next: Run) {
    queryClient.setQueryData(['journey-run', runId], next);
    void queryClient.invalidateQueries({ queryKey: ['journey-runs'] });
    setPicked(null);
  }

  /** Post one step op; 400 field errors come back to the caller, anything else toasts. */
  async function advance(stepId: string, body: StepOp): Promise<Record<string, string> | null> {
    try {
      accept(await api.journeyStep(runId, stepId, body));
      return null;
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 400 &&
        typeof err.data.errors === 'object' &&
        err.data.errors
      ) {
        return err.data.errors as Record<string, string>;
      }
      toast('fail', err instanceof ApiError ? err.message : 'The step could not be saved.');
      if (err instanceof ApiError && err.status === 409) void run.refetch();
      return null;
    }
  }

  async function abandon() {
    try {
      accept(await api.abandonJourney(runId));
    } catch (err) {
      toast('fail', err instanceof ApiError ? err.message : 'Could not abandon the journey.');
    }
    setAbandoning(false);
  }

  const r = run.data;
  const finished = r?.state === 'done' || r?.state === 'abandoned';
  const shownId = picked ?? r?.current ?? null;
  const shown = def?.steps.find((s) => s.id === shownId);

  return (
    <ScopeShell scope={scope} active="/journeys">
      <Breadcrumb
        trail={[
          { label: scope.id, to: base },
          { label: 'Journeys', to: `${base}/journeys` },
          { label: r?.label ?? 'Journey' },
        ]}
        onNav={navigate}
      />
      {run.isError ? (
        <Alert tone="fail">{run.error.message}</Alert>
      ) : catalog.isError ? (
        <Alert tone="fail">{catalog.error.message}</Alert>
      ) : !r || !def ? (
        <Spinner label="Loading journey" />
      ) : (
        <>
          <div className="list-head" style={{ gap: 10 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{r.label}</h1>
            <RunBadge state={r.state} />
            <span style={{ flex: 1 }} />
            {!finished && (
              <Button auto variant="secondary" onClick={() => setAbandoning(true)}>
                Abandon
              </Button>
            )}
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '0 0 16px' }}>
            {r.scope.kind === 'group' ? `Group ${r.scope.id} · ${r.members.join(', ')}` : r.scope.id} ·
            started {timeAgo(r.createdAt)}
          </p>
          <div
            className="split-index"
            style={{
              display: 'grid',
              gridTemplateColumns: '240px minmax(0, 1fr)',
              gap: 20,
              alignItems: 'start',
            }}
          >
            <nav aria-label="Steps" style={{ position: 'sticky', top: 16 }}>
              <JourneyRail
                steps={railOf(def.steps, r)}
                selected={shownId ?? undefined}
                onPick={(id) => setPicked(id === r.current ? null : id)}
              />
            </nav>
            <div style={{ display: 'grid', gap: 12 }}>
              {finished && picked === null ? (
                <Summary run={r} base={base} onAgain={() => navigate(`${base}/journeys`)} />
              ) : shown ? (
                <StepPanel
                  key={`${shown.id}:${r.current === shown.id ? 'live' : 'review'}`}
                  def={def}
                  step={shown}
                  run={r}
                  scope={scope}
                  live={!finished && r.current === shown.id}
                  advance={advance}
                />
              ) : null}
            </div>
          </div>
          {abandoning && (
            <Confirm
              open
              title={`Abandon ${r.label}?`}
              body="Progress stops here and the run is recorded in the audit log. Anything already applied stays applied."
              confirmLabel="Abandon"
              danger
              onConfirm={() => void abandon()}
              onCancel={() => setAbandoning(false)}
            />
          )}
        </>
      )}
    </ScopeShell>
  );
}

function Summary({ run, base, onAgain }: { run: Run; base: string; onAgain: () => void }) {
  const navigate = useNavigate();
  return (
    <Card title={run.state === 'done' ? 'Journey complete' : 'Journey abandoned'}>
      <Alert tone={run.state === 'done' ? 'pass' : 'note'}>
        {run.note ??
          (run.state === 'done' ? 'Every step was confirmed on the switch.' : 'Stopped before the end.')}
      </Alert>
      <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '12px 0 0' }}>
        Pick a step on the left to review its evidence.
        {run.auditId !== null && ` Recorded as audit entry #${run.auditId}.`}
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {run.scope.kind === 'switch' && (
          <Button auto variant="secondary" onClick={() => navigate(`${base}/audit`)}>
            Audit Log
          </Button>
        )}
        <Button auto onClick={onAgain}>
          All journeys
        </Button>
      </div>
    </Card>
  );
}

function StepPanel({
  def,
  step,
  run,
  scope,
  live,
  advance,
}: {
  def: JourneyDef;
  step: JourneyStepDef;
  run: Run;
  scope: Scope;
  /** The step awaiting the operator (false = reviewing a finished one). */
  live: boolean;
  advance: (stepId: string, body: StepOp) => Promise<Record<string, string> | null>;
}) {
  const state = run.steps[step.id];
  const index = def.steps.findIndex((s) => s.id === step.id);
  return (
    <Card
      title={`${index + 1}. ${step.title}`}
      hint={step.help}
      actions={state && !live ? <StatusBadge status={state.status} /> : undefined}
    >
      {step.kind === 'input' ? (
        live ? (
          <InputStep step={step} advance={advance} />
        ) : (
          <Captured run={run} stepId={step.id} />
        )
      ) : step.kind === 'change' ? (
        <ChangeStep step={step} run={run} scope={scope} live={live} advance={advance} />
      ) : (
        <CheckStep step={step} run={run} live={live} advance={advance} />
      )}
      {state?.note && state.note !== 'Not applicable' && (
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '12px 0 0' }}>{state.note}</p>
      )}
    </Card>
  );
}

function StatusBadge({ status }: { status: NonNullable<Run['steps'][string]>['status'] }) {
  const tone =
    status === 'done' ? 'pass' : status === 'blocked' ? 'fail' : status === 'branched' ? 'warn' : 'muted';
  const text = { done: 'Done', skipped: 'Skipped', blocked: 'Blocked', branched: 'Decided' }[status];
  return <Badge tone={tone}>{text}</Badge>;
}

/** Values an input step captured, for review. */
function Captured({ run, stepId }: { run: Run; stepId: string }) {
  const rows = Object.entries(run.values).filter(([k]) => k.startsWith(`${stepId}.`));
  if (rows.length === 0)
    return <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0 }}>No values.</p>;
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'max-content 1fr',
        gap: '4px 16px',
        margin: 0,
        fontSize: 13,
      }}
    >
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt style={{ color: 'var(--color-muted)' }}>{k.slice(stepId.length + 1)}</dt>
          <dd style={{ margin: 0 }}>{Array.isArray(v) ? v.join(', ') : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function InputStep({
  step,
  advance,
}: {
  step: JourneyStepDef;
  advance: (stepId: string, body: StepOp) => Promise<Record<string, string> | null>;
}) {
  const fields = step.fields ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.name, f.default ?? (f.kind === 'choice' ? (f.choices?.[0] ?? '') : '')]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (name: string, v: string) => setValues((prev) => ({ ...prev, [name]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors((await advance(step.id, { op: 'submit', values })) ?? {});
    setBusy(false);
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <div className="form-2col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 20 }}>
        {fields.map((f) => {
          const label = `${f.label}${f.optional ? ' (optional)' : ''}`;
          return f.kind === 'choice' ? (
            <LineDropdown
              key={f.name}
              label={label}
              error={errors[f.name]}
              options={(f.choices ?? []).map((c) => ({ value: c, label: c }))}
              value={values[f.name] ?? ''}
              onChange={(v) => set(f.name, v)}
            />
          ) : (
            <LineField
              key={f.name}
              label={label}
              placeholder={f.hint}
              inputMode={f.kind === 'number' ? 'numeric' : undefined}
              error={errors[f.name]}
              value={values[f.name] ?? ''}
              onChange={(e) => set(f.name, e.target.value)}
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Button auto type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Continue'}
        </Button>
      </div>
    </form>
  );
}

function ChangeStep({
  step,
  run,
  scope,
  live,
  advance,
}: {
  step: JourneyStepDef;
  run: Run;
  scope: Scope;
  live: boolean;
  advance: (stepId: string, body: StepOp) => Promise<Record<string, string> | null>;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [applying, setApplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const evidence = run.steps[step.id]?.evidence;
  const plan = live ? run.plan : undefined;

  async function op(body: StepOp) {
    setBusy(true);
    await advance(step.id, body);
    setBusy(false);
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {live && run.planError && <Alert tone="fail">{run.planError}</Alert>}
      {plan && (
        <div>
          <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '0 0 6px' }}>
            Planned on {run.members.length === 1 ? run.members[0] : `${run.members.length} switches`}:
          </p>
          <CodeBlock lines={plan.flatMap(callCommands).map((text) => ({ text }))} maxHeight="240px" />
        </div>
      )}
      {evidence && <EvidenceList evidence={evidence} />}
      {live && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {step.skippable && (
            <Button auto variant="secondary" disabled={busy} onClick={() => void op({ op: 'skip' })}>
              Skip step
            </Button>
          )}
          <Button auto variant="secondary" disabled={busy} onClick={() => void op({ op: 'verify' })}>
            {busy ? 'Checking…' : evidence ? 'Check again' : 'Already applied? Check'}
          </Button>
          <Button auto disabled={busy || !plan} onClick={() => setApplying(true)}>
            Review and apply
          </Button>
        </div>
      )}
      {applying && plan && (
        <Modal
          open
          onClose={() => setApplying(false)}
          title={step.title}
          width={scope.kind === 'group' ? 600 : 460}
        >
          <ChangeFlow
            scope={scope}
            calls={perMember(plan, run.members)}
            onBack={() => setApplying(false)}
            onClose={() => setApplying(false)}
            onApplied={() => {
              refreshInterfaces(queryClient);
              setApplying(false);
              // Applied is not done: the step completes when the switch confirms it.
              void op({ op: 'verify' });
            }}
            notify={toast}
            doneText={step.title}
          />
        </Modal>
      )}
    </div>
  );
}

function CheckStep({
  step,
  run,
  live,
  advance,
}: {
  step: JourneyStepDef;
  run: Run;
  live: boolean;
  advance: (stepId: string, body: StepOp) => Promise<Record<string, string> | null>;
}) {
  const [busy, setBusy] = useState(false);
  const evidence = run.steps[step.id]?.evidence;
  const ran = useRef(false);

  async function op(body: StepOp) {
    setBusy(true);
    await advance(step.id, body);
    setBusy(false);
  }

  // Checks are reads: a fresh check step runs itself once; re-checks are explicit.
  useEffect(() => {
    if (!live || evidence || ran.current) return;
    ran.current = true;
    void op({ op: 'verify' });
  }, [live]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {busy && !evidence && <Spinner label="Checking on the switch" />}
      {evidence && <EvidenceList evidence={evidence} />}
      {live && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {step.skippable && (
            <Button auto variant="secondary" disabled={busy} onClick={() => void op({ op: 'skip' })}>
              Skip step
            </Button>
          )}
          <Button auto disabled={busy} onClick={() => void op({ op: 'verify' })}>
            {busy ? 'Checking…' : 'Check again'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Per-switch check results: what was read, and each expectation in words. */
function EvidenceList({ evidence }: { evidence: JourneyEvidence[] }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {evidence.map((e, i) => (
        <div
          key={`${e.switchId}:${e.path}:${i}`}
          style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={e.ok ? 'pass' : 'fail'}>{e.ok ? 'Confirmed' : 'Not yet'}</Badge>
            <strong style={{ fontSize: 13 }}>{e.switchId}</strong>
            <code style={{ fontSize: 12, color: 'var(--color-muted)', overflowWrap: 'anywhere' }}>
              {decodeURIComponent(e.path)}
            </code>
          </div>
          {e.error ? (
            <p style={{ fontSize: 13, color: 'var(--color-fail)', margin: '6px 0 0' }}>
              Could not read: {e.error}
            </p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                margin: '6px 0 0',
                padding: 0,
                fontSize: 13,
                display: 'grid',
                gap: 2,
              }}
            >
              {e.lines.map((l, j) => (
                <li key={j}>
                  <span aria-hidden style={{ color: l.ok ? 'var(--color-pass)' : 'var(--color-fail)' }}>
                    {l.ok ? '✓' : '✗'}
                  </span>{' '}
                  {l.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
