/**
 * Interface detail (3A.2 + 3A.7): one port's live values plus statistics and
 * editing. Field set follows the official API reference leaf schemas —
 * not guesses. Edit stages through a branch with dry-run review, then apply.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError } from '../lib/api.js';
import {
  Alert,
  AppShell,
  Breadcrumb,
  Button,
  LineField,
  Modal,
  NavRail,
  Spinner,
  usePinnedRail,
  useToast,
} from '../components/ui.js';
import { Card, Stat, StatRow, packets } from '../components/cards.js';
import { ResourceDetail } from '../components/resource.js';
import { firstDefined, getPath } from '../lib/format.js';
import { switchNav } from '../lib/nav.js';

const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : '—');

export function InterfaceDetail() {
  const { switchId = '', ifaceId = '' } = useParams();
  const navigate = useNavigate();
  const [collapsed, toggleCollapsed] = usePinnedRail('scope');
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  async function logout() {
    await api.logout();
    navigate('/login', { replace: true });
  }
  return (
    <AppShell
      rail={
        <NavRail
          brand={false}
          back={{ label: 'Switches', to: '/switches' }}
          scope={{ kind: 'switch', name: switchId }}
          items={switchNav(switchId)}
          active={`/switches/${switchId}/interfaces`}
          onNav={navigate}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
        />
      }
    >
      <Breadcrumb
        trail={[
          { label: switchId, to: `/switches/${switchId}` },
          { label: 'Interfaces', to: `/switches/${switchId}/interfaces` },
          { label: ifaceId },
        ]}
        onNav={navigate}
      />
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{ifaceId}</h1>
        <span style={{ flex: 1 }} />
        <InterfaceEdit switchId={switchId} ifaceId={ifaceId} />
      </div>
      <InterfaceStats switchId={switchId} path={`/interface/${ifaceId}`} />
      <div style={{ marginTop: 12 }}>
        <ResourceDetail
          switchId={switchId}
          path={`/interface/${ifaceId}`}
          fields={[
            { label: 'State', value: (o) => firstDefined(o, 'link/state', 'link/oper-status') ?? '—' },
            { label: 'Admin status', value: (o) => text(getPath(o, 'link/admin-status')) },
            { label: 'Speed', value: (o) => text(getPath(o, 'link/speed')) },
            { label: 'MTU', value: (o) => text(getPath(o, 'link/mtu')) },
            { label: 'MAC address', value: (o) => text(getPath(o, 'link/mac-address')) },
            { label: 'Description', value: (o) => text(getPath(o, 'description')) },
            { label: 'VRF', value: (o) => text(getPath(o, 'ip/vrf')) },
            { label: 'Type', value: (o) => text(getPath(o, 'type')) },
          ]}
        />
      </div>
      <div style={{ marginTop: 16 }}>
        <InterfaceTraffic switchId={switchId} ifaceId={ifaceId} path={`/interface/${ifaceId}`} />
      </div>
    </AppShell>
  );
}

/** Parse a counter that arrives as a number or a human string ("11.96 KB"). */
function counterOf(obj: Record<string, unknown>, path: string): number | undefined {
  const v = getPath(obj, path);
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/^([\d.]+)\s*([KMGT]?B)?/i);
    if (!m) return undefined;
    const mult = { '': 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 } as Record<string, number>;
    const unit = (m[2] ?? '').toUpperCase();
    return Number(m[1]) * (mult[unit] ?? 1);
  }
  return undefined;
}

function sumOf(obj: Record<string, unknown>, ...paths: string[]): number | undefined {
  let total = 0;
  let seen = false;
  for (const p of paths) {
    const v = counterOf(obj, p);
    if (v !== undefined) {
      total += v;
      seen = true;
    }
  }
  return seen ? total : undefined;
}

const statText = (v: number | undefined, fmt: (n: number) => string) => (v === undefined ? '—' : fmt(v));

/**
 * Statistics card: every counter the port exposes (`link/stats/*` per the
 * reference), read from the same cached detail object — no second fetch.
 * EtHTool depth + clear action arrive with 3A.4.
 */
function InterfaceStats({ switchId, path }: { switchId: string; path: string }) {
  const detail = useQuery({
    queryKey: ['resource-obj', switchId, path],
    queryFn: () => api.query<Record<string, unknown>>(switchId, path),
    retry: false,
    staleTime: 30_000,
  });
  if (detail.isPending || detail.isError || !detail.data) return null;
  const o = detail.data.data;
  return (
    <Card title="Statistics">
      <StatRow columns={7}>
        <Stat label="In packets" value={statText(counterOf(o, 'link/stats/in-pkts'), packets)} />
        <Stat label="Out packets" value={statText(counterOf(o, 'link/stats/out-pkts'), packets)} />
        <Stat label="In bytes" value={statText(counterOf(o, 'link/stats/in-bytes'), packets)} />
        <Stat label="Out bytes" value={statText(counterOf(o, 'link/stats/out-bytes'), packets)} />
        <Stat
          label="Drops"
          value={statText(sumOf(o, 'link/stats/in-drops', 'link/stats/out-drops'), packets)}
        />
        <Stat
          label="Errors"
          value={statText(sumOf(o, 'link/stats/in-errors', 'link/stats/out-errors'), packets)}
        />
        <Stat
          label="Carrier transitions"
          value={statText(counterOf(o, 'link/stats/carrier-transitions'), packets)}
        />
      </StatRow>
    </Card>
  );
}

type DiffRow = {
  path: string;
  method: string;
  state?: string;
  before?: unknown;
  mine?: unknown;
  current?: unknown;
};

const shortVal = (v: unknown) =>
  v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);

const JOB_DONE = new Set(['successful', 'done', 'applied', 'action_success', 'complete', 'completed']);

/**
 * InterfaceEdit (3A.7): description/MTU/speed through branch → stage →
 * dry-run review → apply, with conflict discard and job polling. One
 * focused modal, never a bare form.
 */
function InterfaceEdit({ switchId, ifaceId }: { switchId: string; ifaceId: string }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button auto variant="secondary" onClick={() => setOpen(true)}>
        Edit interface
      </Button>
      {open && (
        <EditModal
          switchId={switchId}
          ifaceId={ifaceId}
          onClose={() => setOpen(false)}
          onApplied={() => {
            queryClient.invalidateQueries({ queryKey: ['resource-obj', switchId] });
            queryClient.invalidateQueries({ queryKey: ['resource', switchId] });
          }}
          notify={toast}
        />
      )}
    </>
  );
}

function EditModal({
  switchId,
  ifaceId,
  onClose,
  onApplied,
  notify,
}: {
  switchId: string;
  ifaceId: string;
  onClose: () => void;
  onApplied: () => void;
  notify: (tone: 'pass' | 'warn' | 'fail', text: string) => void;
}) {
  const path = `/interface/${ifaceId}`;
  const detail = useQuery({
    queryKey: ['resource-obj', switchId, path],
    queryFn: () => api.query<Record<string, unknown>>(switchId, path),
    retry: false,
    staleTime: 30_000,
  });
  const [description, setDescription] = useState<string | null>(null);
  const [mtu, setMtu] = useState<string | null>(null);
  const [speed, setSpeed] = useState<string | null>(null);
  const [step, setStep] = useState<'form' | 'review' | 'applying' | 'done'>('form');
  const [diffs, setDiffs] = useState<DiffRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [jobState, setJobState] = useState<string | null>(null);

  const current = detail.data?.data ?? {};
  const curDescription = description ?? String(getPath(current, 'description') ?? '');
  const curMtu = mtu ?? String(getPath(current, 'link/mtu') ?? '');
  const curSpeed = speed ?? String(getPath(current, 'link/speed') ?? '');

  function fail(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.message : fallback);
    setBusy(false);
  }

  async function save() {
    const body: Record<string, unknown> = {};
    if (description !== null && description !== String(getPath(current, 'description') ?? '')) {
      body.description = description;
    }
    if (mtu !== null && mtu !== String(getPath(current, 'link/mtu') ?? '')) {
      const n = Number(mtu);
      if (!Number.isInteger(n) || n <= 0) {
        setError('MTU must be a positive integer.');
        return;
      }
      body.mtu = n;
    }
    if (speed !== null && speed !== String(getPath(current, 'link/speed') ?? '')) {
      body.speed = speed;
    }
    if (Object.keys(body).length === 0) {
      setError('No changes to stage.');
      return;
    }
    setBusy(true);
    setError(null);
    setConflict(false);
    try {
      await api.openBranch(switchId);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true);
        setBusy(false);
        return;
      }
      fail(err, 'Could not open a branch.');
      return;
    }
    try {
      await api.stageChange(switchId, { path, method: 'PATCH', body });
      const diff = await api.getDiff(switchId);
      setDiffs(diff.diffs);
      setStep('review');
    } catch (err) {
      fail(err, 'Could not stage the change.');
      return;
    }
    setBusy(false);
  }

  async function discardAndRetry() {
    setBusy(true);
    try {
      await api.discardBranch(switchId);
      setConflict(false);
      setBusy(false);
      await save();
    } catch (err) {
      fail(err, 'Could not discard the branch.');
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    setStep('applying');
    try {
      const res = await api.applyBranch(switchId);
      if (!res.jobId) {
        finish();
        return;
      }
      const deadline = Date.now() + 120_000;
      for (;;) {
        const job = await api.getJob(switchId, res.jobId);
        setJobState(job.state);
        const state = job.state.toLowerCase();
        if (JOB_DONE.has(state)) {
          finish();
          return;
        }
        if (state.includes('fail') || state.includes('error')) {
          setError(`Apply job ${res.jobId} failed: ${job.state}`);
          setBusy(false);
          setStep('review');
          return;
        }
        if (Date.now() > deadline) {
          setError(`Apply job ${res.jobId} did not finish in time (${job.state}).`);
          setBusy(false);
          setStep('review');
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (err) {
      fail(err, 'Apply failed.');
      setStep('review');
    }
  }

  function finish() {
    setBusy(false);
    setJobState(null);
    setStep('done');
    onApplied();
    notify('pass', `Interface ${ifaceId} updated.`);
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${ifaceId}`}>
      {detail.isPending ? (
        <Spinner label="Loading current values" />
      ) : step === 'form' ? (
        <>
          <LineField
            label="Description"
            value={curDescription}
            onChange={(e) => setDescription(e.target.value)}
          />
          <LineField
            label="MTU"
            value={curMtu}
            onChange={(e) => setMtu(e.target.value)}
            inputMode="numeric"
          />
          <LineField
            label="Speed"
            value={curSpeed}
            onChange={(e) => setSpeed(e.target.value)}
            placeholder="e.g. 10G"
          />
          {error && <Alert tone="fail">{error}</Alert>}
          {conflict && (
            <Alert tone="warn">
              Unapplied changes already staged on this switch.{' '}
              <button
                type="button"
                onClick={discardAndRetry}
                disabled={busy}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  font: 'inherit',
                  color: 'var(--color-text)',
                  textDecoration: 'underline',
                  textUnderlineOffset: 3,
                }}
              >
                Discard them and stage mine instead
              </button>
            </Alert>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button auto variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button auto onClick={save} disabled={busy}>
              {busy ? 'Staging…' : 'Review change'}
            </Button>
          </div>
        </>
      ) : step === 'review' ? (
        <>
          <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: '0 0 12px' }}>
            Dry-run: this is exactly what apply will send.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {diffs.map((d, i) => (
              <li
                key={`${d.path}-${i}`}
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: 13,
                }}
              >
                <span className="mono">{d.path}</span>
                <br />
                <span style={{ color: 'var(--color-muted)' }}>{shortVal(d.before)} → </span>
                <span style={{ color: 'var(--color-text)', fontWeight: 700 }}>{shortVal(d.mine)}</span>
              </li>
            ))}
          </ul>
          {error && <Alert tone="fail">{error}</Alert>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button auto variant="secondary" onClick={() => setStep('form')} disabled={busy}>
              Back
            </Button>
            <Button auto onClick={apply} disabled={busy}>
              Apply
            </Button>
          </div>
        </>
      ) : step === 'applying' ? (
        <div style={{ display: 'grid', gap: 12, justifyItems: 'center', padding: '12px 0' }}>
          <Spinner label="Applying" />
          <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0 }}>
            {jobState ? `Job state: ${jobState}` : 'Sending to the switch…'}
          </p>
        </div>
      ) : (
        <>
          <Alert tone="pass">Applied. The switch reports the change.</Alert>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button auto onClick={onClose}>
              Done
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

interface TrafficSample {
  t: number;
  inB: number;
  outB: number;
}

const SAMPLE_INTERVAL_MS = 5000;
const MAX_SAMPLES = 120;

function sampleKey(switchId: string, ifaceId: string): string {
  return `cumulus.traffic.v1:${switchId}:${ifaceId}`;
}

function loadSamples(key: string): TrafficSample[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TrafficSample[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => typeof s?.t === 'number' && typeof s?.inB === 'number' && typeof s?.outB === 'number')
      .slice(-MAX_SAMPLES);
  } catch {
    return [];
  }
}

/**
 * Live traffic graph: samples interface byte counters every 5s (direct
 * reads, isolated from the detail cache) and plots in/out bit rates.
 * Samples persist per port across visits; the graph appears once two
 * samples exist. No backend history store — yet.
 */
function InterfaceTraffic({ switchId, ifaceId, path }: { switchId: string; ifaceId: string; path: string }) {
  const key = sampleKey(switchId, ifaceId);
  const [samples, setSamples] = useState<TrafficSample[]>(() => loadSamples(key));
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    let dead = false;
    async function tick() {
      try {
        const res = await api.query<Record<string, unknown>>(switchId, path);
        if (dead) return;
        const inB = counterOf(res.data, 'link/stats/in-bytes');
        const outB = counterOf(res.data, 'link/stats/out-bytes');
        if (inB === undefined || outB === undefined) return;
        setSamples((prev) => {
          const next = [...prev, { t: Date.now(), inB, outB }].slice(-MAX_SAMPLES);
          try {
            localStorage.setItem(keyRef.current, JSON.stringify(next));
          } catch {
            /* storage full or disabled: memory still works */
          }
          return next;
        });
      } catch {
        /* switch hiccup: keep old samples, try next tick */
      }
    }
    tick();
    const id = setInterval(tick, SAMPLE_INTERVAL_MS);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [switchId, path]);

  const points: Array<{ label: string; In: number; Out: number }> = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b) continue;
    const dt = (b.t - a.t) / 1000;
    const inRate = ((b.inB - a.inB) * 8) / dt;
    const outRate = ((b.outB - a.outB) * 8) / dt;
    if (dt <= 0 || inRate < 0 || outRate < 0) continue;
    points.push({
      label: new Date(b.t).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      In: Math.round(inRate),
      Out: Math.round(outRate),
    });
  }
  const bps = (v: number) => `${packets(v)}bps`;

  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Traffic">
        {points.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>
            Collecting live samples every 5 seconds — the graph appears shortly and persists across visits.
          </p>
        ) : (
          <div style={{ height: 224 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ left: 8, right: 8 }}>
                <defs>
                  <linearGradient id="trafficInFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-pass)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-pass)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="trafficOutFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} minTickGap={40} />
                <YAxis
                  tickFormatter={(v) => bps(Number(v))}
                  tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
                  width={64}
                />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 12,
                    fontSize: 13,
                  }}
                  labelStyle={{ color: 'var(--color-text)', fontWeight: 600, marginBottom: 2 }}
                  itemStyle={{ color: 'var(--color-text)' }}
                  cursor={{ fill: 'var(--color-muted)', fillOpacity: 0.07 }}
                  formatter={(v) => bps(typeof v === 'number' ? v : Number(v))}
                />
                <Area
                  type="monotone"
                  dataKey="In"
                  stroke="var(--color-pass)"
                  strokeWidth={2}
                  fill="url(#trafficInFill)"
                />
                <Area
                  type="monotone"
                  dataKey="Out"
                  stroke="var(--color-brand)"
                  strokeWidth={2}
                  fill="url(#trafficOutFill)"
                />
                <Legend wrapperStyle={{ fontSize: 13, color: 'var(--color-muted)' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
