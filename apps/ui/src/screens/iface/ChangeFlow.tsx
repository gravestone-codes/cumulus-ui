/**
 * ChangeFlow: the one stage → dry-run → apply → results path for interface
 * writes in either scope (design §4A). Callers hand it per-switch NVUE calls;
 * it stages (branch per switch; FanOut for groups, exclusive so reviews show
 * only this change), shows each switch's diff, applies only switches that
 * staged, and reports per switch. Unapplied work elsewhere is never piled
 * onto silently — the user discards it or goes back.
 */
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type MemberResult, type StageCall, type StagedDiff } from '../../lib/api.js';
import { Alert, Button, Spinner, Tabs } from '../../components/ui.js';
import { stageRounds } from './plan.js';
import type { Scope } from './scope.js';

const JOB_DONE = new Set([
  'successful',
  'success',
  'done',
  'applied',
  'action_success',
  'complete',
  'completed',
]);
const shortVal = (v: unknown) =>
  v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);

async function discard(switches: string[]) {
  await Promise.all(switches.map((sw) => api.discardBranch(sw).catch(() => undefined)));
}

export function ChangeFlow({
  scope,
  calls,
  unchanged = [],
  warning,
  onBack,
  onClose,
  onApplied,
  notify,
  doneText,
}: {
  scope: Scope;
  /** Per-switch NVUE calls; switches absent here are not touched. */
  calls: Record<string, StageCall[]>;
  /** Members that already match (shown as "no change"). */
  unchanged?: string[];
  /** Shown on the review step (e.g. service-affecting note). */
  warning?: string;
  onBack: () => void;
  onClose: () => void;
  onApplied: () => void;
  notify: (tone: 'pass' | 'warn' | 'fail', text: string) => void;
  /** Toast text after apply, e.g. "Link on swp1". */
  doneText: string;
}) {
  const group = scope.kind === 'group';
  const [step, setStep] = useState<'staging' | 'conflict' | 'review' | 'applying' | 'done'>('staging');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string[]>([]);
  const [staged, setStaged] = useState<string[]>([]);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [diffs, setDiffs] = useState<Record<string, StagedDiff[]>>({});
  const [tab, setTab] = useState('');
  const [results, setResults] = useState<MemberResult[]>([]);
  const [jobState, setJobState] = useState<string | null>(null);
  const started = useRef(false);

  async function stage() {
    setStep('staging');
    setError(null);
    const bad: Record<string, string> = {};
    let ok: string[] = [];
    try {
      if (scope.kind === 'switch') {
        try {
          await api.openBranch(scope.id);
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            setConflict([scope.id]);
            setStep('conflict');
            return;
          }
          throw err;
        }
        for (const call of calls[scope.id] ?? []) await api.stageChange(scope.id, call);
        ok = [scope.id];
      } else {
        const conflicted: string[] = [];
        for (const round of stageRounds(calls)) {
          const members = round.members.filter((m) => !bad[m] && !conflicted.includes(m));
          if (members.length === 0) continue;
          const res = await api.groupStage(scope.id, {
            path: round.path,
            method: round.method,
            members,
            exclusive: round.exclusive,
            ...(round.bodies
              ? { bodies: Object.fromEntries(members.map((m) => [m, round.bodies?.[m] ?? {}])) }
              : {}),
          });
          for (const r of res.results) {
            if (r.ok) continue;
            if (r.conflict) conflicted.push(r.switchId);
            else bad[r.switchId] = r.error ?? 'stage failed';
          }
        }
        ok = Object.keys(calls).filter((m) => !bad[m] && !conflicted.includes(m));
        if (conflicted.length > 0) {
          // Roll back this attempt so a retry starts clean on every member.
          await discard(ok);
          setConflict(conflicted);
          setStep('conflict');
          return;
        }
      }
      const got = await Promise.all(ok.map(async (sw) => [sw, (await api.getDiff(sw)).diffs] as const));
      setDiffs(Object.fromEntries(got));
      setStaged(ok);
      setFailed(bad);
      setTab(ok[0] ?? '');
      setStep('review');
    } catch (err) {
      await discard(ok);
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not stage the change.');
      setStep('conflict');
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void stage();
  }, []);

  async function discardAndRetry() {
    setBusy(true);
    await discard(conflict);
    setConflict([]);
    setBusy(false);
    await stage();
  }

  async function back() {
    setBusy(true);
    await discard(staged);
    setBusy(false);
    onBack();
  }

  async function apply() {
    setBusy(true);
    setError(null);
    setStep('applying');
    try {
      let res: MemberResult[];
      if (scope.kind === 'switch') {
        const r = await api.applyBranch(scope.id);
        if (r.jobId) await waitJob(scope.id, r.jobId);
        res = [{ switchId: scope.id, ok: true, jobId: r.jobId }];
      } else {
        res = (await api.groupApply(scope.id, staged)).results;
      }
      setResults(res);
      setStep('done');
      onApplied();
      const okCount = res.filter((r) => r.ok).length;
      notify(
        okCount === res.length ? 'pass' : 'warn',
        group ? `${doneText}: applied on ${okCount} of ${res.length}.` : `${doneText}: applied.`,
      );
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Apply failed.');
      setStep('review');
    }
    setBusy(false);
  }

  async function waitJob(sw: string, jobId: string) {
    const deadline = Date.now() + 120_000;
    for (;;) {
      const job = await api.getJob(sw, jobId);
      setJobState(job.state);
      const state = job.state.toLowerCase();
      if (JOB_DONE.has(state)) return;
      if (state.includes('fail') || state.includes('error'))
        throw new Error(`Apply job ${jobId} failed: ${job.state}`);
      if (Date.now() > deadline) throw new Error(`Apply job ${jobId} did not finish in time (${job.state}).`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  if (step === 'staging' || step === 'applying') {
    return (
      <div style={{ display: 'grid', gap: 12, justifyItems: 'center', padding: '12px 0' }}>
        <Spinner label={step === 'staging' ? 'Staging' : 'Applying'} />
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0 }}>
          {step === 'staging'
            ? `Staging on ${Object.keys(calls).join(', ')}…`
            : jobState
              ? `Job state: ${jobState}`
              : `Applying on ${staged.join(', ')}…`}
        </p>
      </div>
    );
  }

  if (step === 'conflict') {
    return (
      <>
        {conflict.length > 0 && (
          <Alert tone="warn">
            Unapplied changes are already staged on {conflict.join(', ')}. Discard them to stage this change,
            or go back.
          </Alert>
        )}
        {error && <Alert tone="fail">{error}</Alert>}
        <div style={actionsRow}>
          <Button auto variant="secondary" onClick={onBack} disabled={busy}>
            Back
          </Button>
          {conflict.length > 0 ? (
            <Button auto onClick={discardAndRetry} disabled={busy}>
              {busy ? 'Discarding…' : 'Discard and stage mine'}
            </Button>
          ) : (
            <Button auto onClick={() => void stage()} disabled={busy}>
              Try again
            </Button>
          )}
        </div>
      </>
    );
  }

  if (step === 'done') {
    return (
      <>
        {group ? (
          <ResultList results={results} unchanged={unchanged} />
        ) : (
          <Alert tone="pass">Applied. The switch reports the change.</Alert>
        )}
        <div style={actionsRow}>
          <Button auto onClick={onClose}>
            Done
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: '0 0 12px' }}>
        Dry-run: this is exactly what apply will send{group ? ', per switch' : ''}.
      </p>
      {group && staged.length > 1 && (
        <Tabs
          tabs={staged.map((sw) => ({ id: sw, label: `${sw} · ${diffs[sw]?.length ?? 0}` }))}
          active={tab}
          onChange={setTab}
        />
      )}
      {group && staged.length === 1 && (
        <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>{staged[0]}</p>
      )}
      <DiffList rows={diffs[tab] ?? []} />
      {unchanged.length > 0 && (
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '10px 0 0' }}>
          {unchanged.join(', ')} already match{unchanged.length === 1 ? 'es' : ''} — no change there.
        </p>
      )}
      {Object.keys(failed).length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Alert tone="fail">
            Not staged —{' '}
            {Object.entries(failed)
              .map(([sw, e]) => `${sw}: ${e}`)
              .join('; ')}
          </Alert>
        </div>
      )}
      {warning && (
        <div style={{ marginTop: 10 }}>
          <Alert tone="warn">{warning}</Alert>
        </div>
      )}
      {error && <Alert tone="fail">{error}</Alert>}
      <div style={actionsRow}>
        <Button auto variant="secondary" onClick={back} disabled={busy}>
          Back
        </Button>
        <Button auto onClick={apply} disabled={busy || staged.length === 0}>
          {group ? `Apply to ${staged.length} switch${staged.length === 1 ? '' : 'es'}` : 'Apply'}
        </Button>
      </div>
    </>
  );
}

/** Staged paths as before → after rows (own dry-run and others' staged work share it). */
export function DiffList({ rows }: { rows: StagedDiff[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {rows.map((d, i) => (
        <li
          key={`${d.path}-${i}`}
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 13,
            overflowWrap: 'anywhere',
          }}
        >
          <span className="mono">
            {d.method === 'DELETE' ? 'remove ' : ''}
            {decodeURIComponent(d.path)}
          </span>
          <br />
          <span style={{ color: 'var(--color-muted)' }}>{shortVal(d.before)} → </span>
          <span style={{ color: 'var(--color-text)', fontWeight: 700 }}>
            {d.method === 'DELETE' ? 'removed' : shortVal(d.mine)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Per-switch outcome rows (fan-out apply and group actions share this). */
export function ResultList({ results, unchanged = [] }: { results: MemberResult[]; unchanged?: string[] }) {
  return (
    <div style={{ fontSize: 14 }}>
      {results.map((r) => (
        <div key={r.switchId} style={resultRow}>
          <span style={{ fontWeight: 600 }}>{r.switchId}</span>
          <span style={{ color: r.ok ? 'var(--color-pass)' : 'var(--color-fail)', textAlign: 'right' }}>
            {r.ok ? `✓ done${r.jobId ? ` · job ${r.jobId}` : ''}` : `✕ ${r.error ?? 'failed'}`}
          </span>
        </div>
      ))}
      {unchanged.map((sw) => (
        <div key={sw} style={resultRow}>
          <span style={{ fontWeight: 600 }}>{sw}</span>
          <span style={{ color: 'var(--color-muted)' }}>no change</span>
        </div>
      ))}
    </div>
  );
}

const resultRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  padding: '8px 0',
  borderBottom: '1px solid var(--color-border)',
};
const actionsRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
  marginTop: 16,
};
