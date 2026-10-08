/**
 * ChangeFlow: the one stage → dry-run → apply → results path for interface
 * writes in either scope (design §4A). Callers hand it per-switch NVUE calls;
 * it stages (branch per switch; FanOut for groups, exclusive so reviews show
 * only this change), shows each switch's diff, applies only switches that
 * staged, and reports per switch. Unapplied work elsewhere is never piled
 * onto silently — the user discards it or goes back. A switch changed outside
 * the app must be refreshed before a new edit starts (roadmap 4.6).
 */
import { useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type ApplyConflict,
  type Drift,
  type MemberResult,
  type StageCall,
  type StagedDiff,
} from '../../lib/api.js';
import { Alert, Button, Spinner, Tabs } from '../../components/ui.js';
import { stageRounds } from './plan.js';
import { driftBy, useRefreshSwitches } from './ScopeShell.js';
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

/** Apply-time 409s carry the overlap diffs; anything else is a plain error. */
function applyConflictsOf(err: unknown): ApplyConflict[] | null {
  if (err instanceof ApiError && err.status === 409 && Array.isArray(err.data.conflicts)) {
    return err.data.conflicts as ApplyConflict[];
  }
  return null;
}

/** Opening a branch on a switch that changed outside the app since the user last refreshed. */
function isSwitchChanged(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && err.data.code === 'switch-changed';
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
  const [step, setStep] = useState<
    'staging' | 'conflict' | 'changed' | 'applyConflict' | 'review' | 'applying' | 'done'
  >('staging');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string[]>([]);
  const [changed, setChanged] = useState<string[]>([]);
  const [applyConflicts, setApplyConflicts] = useState<Record<string, ApplyConflict[]>>({});
  const [outOfBand, setOutOfBand] = useState<Record<string, Drift>>({});
  const refreshSwitches = useRefreshSwitches();
  const [conflictTab, setConflictTab] = useState('');
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
          if (isSwitchChanged(err)) {
            setChanged([scope.id]);
            setStep('changed');
            return;
          }
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
        const drifted: string[] = [];
        for (const round of stageRounds(calls)) {
          const members = round.members.filter(
            (m) => !bad[m] && !conflicted.includes(m) && !drifted.includes(m),
          );
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
            if (r.drift) drifted.push(r.switchId);
            else if (r.conflict) conflicted.push(r.switchId);
            else bad[r.switchId] = r.error ?? 'stage failed';
          }
        }
        ok = Object.keys(calls).filter((m) => !bad[m] && !conflicted.includes(m) && !drifted.includes(m));
        if (drifted.length > 0) {
          await discard(ok);
          setChanged(drifted);
          setStep('changed');
          return;
        }
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
        try {
          const r = await api.applyBranch(scope.id);
          if (r.jobId) await waitJob(scope.id, r.jobId);
          res = [{ switchId: scope.id, ok: true, jobId: r.jobId }];
        } catch (err) {
          const conflicts = applyConflictsOf(err);
          if (conflicts) {
            const oob = err instanceof ApiError ? (err.data.outOfBand as Drift | undefined) : undefined;
            setOutOfBand(oob ? { [scope.id]: oob } : {});
            setApplyConflicts({ [scope.id]: conflicts });
            setConflictTab(scope.id);
            setBusy(false);
            setStep('applyConflict');
            return;
          }
          throw err;
        }
      } else {
        res = (await api.groupApply(scope.id, staged)).results;
        const clashes: Record<string, ApplyConflict[]> = {};
        const oob: Record<string, Drift> = {};
        for (const r of res) {
          if (!r.ok && r.conflicts?.length) clashes[r.switchId] = r.conflicts;
          if (!r.ok && r.outOfBand) oob[r.switchId] = r.outOfBand;
        }
        if (Object.keys(clashes).length > 0) {
          setOutOfBand(oob);
          setResults(res);
          setApplyConflicts(clashes);
          setConflictTab(Object.keys(clashes)[0] ?? '');
          setBusy(false);
          setStep('applyConflict');
          return;
        }
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

  async function rebaseAndApply() {
    const members = Object.keys(applyConflicts);
    setBusy(true);
    setError(null);
    try {
      let res: MemberResult[];
      if (scope.kind === 'switch') {
        const r = await api.rebaseBranch(scope.id);
        if (r.alreadyApplied || !r.rebased) {
          notify('pass', 'Already applied by someone else — nothing left to change.');
          setBusy(false);
          onClose();
          return;
        }
        if (r.dropped.length > 0) {
          notify('warn', `Already landed elsewhere — dropped ${r.dropped.join(', ')}.`);
        }
        setStep('applying');
        const a = await api.applyBranch(scope.id);
        if (a.jobId) await waitJob(scope.id, a.jobId);
        res = [{ switchId: scope.id, ok: true, jobId: a.jobId }];
      } else {
        const rb = (await api.groupRebase(scope.id, members)).results;
        const failed = rb.filter((r) => !r.ok);
        if (failed.length > 0) {
          throw new Error(failed.map((r) => `${r.switchId}: ${r.error ?? 'rebase failed'}`).join('; '));
        }
        const dropped = rb.flatMap((r) => r.dropped ?? []);
        if (dropped.length > 0) {
          notify('warn', `Already landed elsewhere — dropped ${dropped.join(', ')}.`);
        }
        const fresh = rb.filter((r) => r.rebased).map((r) => r.switchId);
        if (fresh.length === 0) {
          notify('pass', 'Already applied by someone else — nothing left to change.');
          setBusy(false);
          onClose();
          return;
        }
        setStep('applying');
        const applied = (await api.groupApply(scope.id, fresh)).results;
        const merged = new Map(results.map((r) => [r.switchId, r]));
        for (const r of applied) merged.set(r.switchId, r);
        res = [...merged.values()];
      }
      setApplyConflicts({});
      setResults(res);
      setStep('done');
      onApplied();
      const okCount = res.filter((r) => r.ok).length;
      notify(
        okCount === res.length ? 'pass' : 'warn',
        group ? `${doneText}: applied on ${okCount} of ${res.length}.` : `${doneText}: applied.`,
      );
    } catch (err) {
      // The draft survives a failed rebase — stay on the conflict screen.
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Rebase failed.');
      setStep('applyConflict');
    }
    setBusy(false);
  }

  async function refreshAndBack() {
    setBusy(true);
    setError(null);
    try {
      await refreshSwitches(changed);
      onBack();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Refresh failed.');
    }
    setBusy(false);
  }

  async function discardMine() {
    setBusy(true);
    await discard(Object.keys(applyConflicts));
    setBusy(false);
    notify('warn', 'Discarded your staged changes.');
    onClose();
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

  if (step === 'changed') {
    return (
      <>
        <Alert tone="warn">
          {changed.join(', ')} changed outside the app since you loaded {changed.length === 1 ? 'it' : 'them'}
          . Refresh to see the current config, then make your change again.
        </Alert>
        {error && <Alert tone="fail">{error}</Alert>}
        <div style={actionsRow}>
          <Button auto variant="secondary" onClick={onBack} disabled={busy}>
            Back
          </Button>
          <Button auto onClick={() => void refreshAndBack()} disabled={busy}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </>
    );
  }

  if (step === 'applyConflict') {
    const conflicted = Object.keys(applyConflicts);
    const appliedClean = results.filter((r) => r.ok);
    const outside = conflicted.filter((sw) => outOfBand[sw]);
    return (
      <>
        <Alert tone="warn">
          {outside.length > 0 ? (
            <>
              {outside.map((sw) => (
                <div key={sw}>
                  {sw} changed outside the app since you staged{driftBy(outOfBand[sw] as Drift)}.
                </div>
              ))}
              Review your draft against what is on the switch now. Your draft is kept.
            </>
          ) : (
            <>
              {conflicted.join(', ')} changed since you staged — someone applied there first. Your draft is
              kept.
            </>
          )}
        </Alert>
        {group && appliedClean.length > 0 && (
          <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '10px 0 0' }}>
            Applied on {appliedClean.map((r) => r.switchId).join(', ')} — only{' '}
            {conflicted.length === 1 ? 'this member' : 'these members'} conflicted.
          </p>
        )}
        <div style={{ marginTop: 12 }}>
          {conflicted.length > 1 && (
            <Tabs
              tabs={conflicted.map((sw) => ({
                id: sw,
                label: `${sw} · ${applyConflicts[sw]?.length ?? 0}`,
              }))}
              active={conflictTab}
              onChange={setConflictTab}
            />
          )}
          {conflicted.length === 1 && (
            <p style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>{conflicted[0]}</p>
          )}
          <ConflictList rows={applyConflicts[conflictTab] ?? []} />
        </div>
        {error && <Alert tone="fail">{error}</Alert>}
        <div style={actionsRow}>
          <Button auto variant="secondary" onClick={onBack} disabled={busy}>
            Back
          </Button>
          <Button auto variant="danger" onClick={discardMine} disabled={busy}>
            {busy ? 'Discarding…' : 'Discard mine'}
          </Button>
          <Button auto onClick={rebaseAndApply} disabled={busy}>
            {busy ? 'Rebasing…' : 'Rebase and apply'}
          </Button>
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '8px 0 0', textAlign: 'right' }}>
          Back keeps your draft.
        </p>
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

/** One overlap as base · mine · landed, with attribution for the landed value. */
export function ConflictList({ rows }: { rows: ApplyConflict[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {rows.map((c, i) => (
        <li
          key={`${c.path}-${i}`}
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
            {c.method === 'DELETE' ? 'remove ' : ''}
            {decodeURIComponent(c.path)}
          </span>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginTop: 8 }}>
            <div>
              <div style={conflictHead}>Base · when you staged</div>
              <div className="mono" style={{ color: 'var(--color-muted)' }}>
                {shortVal(c.before)}
              </div>
            </div>
            <div>
              <div style={conflictHead}>Mine · staged</div>
              <div className="mono" style={{ color: 'var(--color-text)', fontWeight: 700 }}>
                {c.method === 'DELETE' ? 'removed' : shortVal(c.mine)}
              </div>
            </div>
            <div>
              <div style={conflictHead}>Landed · on the switch now</div>
              <div className="mono" style={{ color: 'var(--color-warn)', fontWeight: 700 }}>
                {shortVal(c.current)}
              </div>
              <div style={{ color: 'var(--color-muted)', fontSize: 12, marginTop: 2 }}>
                {JSON.stringify(c.current) === JSON.stringify(c.before)
                  ? 'unchanged since you staged'
                  : c.landedBy
                    ? `by ${c.landedBy.username}`
                    : 'changed outside the app'}
              </div>
            </div>
          </div>
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

const conflictHead: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--color-muted)',
  marginBottom: 2,
};
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
