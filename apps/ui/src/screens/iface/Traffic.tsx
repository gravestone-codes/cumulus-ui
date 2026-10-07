/**
 * Single-switch traffic + counters (3A.3/3A.4): live in/out rates from 5s
 * counter reads seeded by the server, history ranges, compare overlays,
 * discards & errors. Group scope composes GroupTraffic instead.
 */
import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../lib/api.js';
import { Alert, Button, Modal, SelectMenu, Tabs } from '../../components/ui.js';
import { Card, Stat, StatRow, packets } from '../../components/cards.js';
import { ReadError } from '../../components/resource.js';
import { mergeSamples, overlayCompare, type TrafficSample } from '../../lib/traffic.js';
import {
  dayStart,
  defaultPeriod,
  covered,
  HOUR_MS,
  spanLabel,
  type Period,
  type PeriodKind,
} from '../../lib/calendar.js';
import { PeriodPicker } from '../../components/period.js';
import { getPath } from '../../lib/format.js';

/** Parse a counter that arrives as a number or a human string ("11.96 KB"). */
export function counterOf(obj: Record<string, unknown>, path: string): number | undefined {
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

export function sumOf(obj: Record<string, unknown>, ...paths: string[]): number | undefined {
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
export function InterfaceStats({ switchId, path }: { switchId: string; path: string }) {
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

const SAMPLE_INTERVAL_MS = 5000;
/** Live view span: the server seed covers it on arrival, ticks extend it. */
const LIVE_WINDOW_MS = 15 * 60_000;
/** Consecutive failed ticks before the live read error surfaces (one hiccup stays quiet). */
const LIVE_FAILS_TO_SHOW = 2;
const DAY_MS = 86_400_000;

type HistoryRange = '24h' | '7d' | '30d' | '1y' | '3y';
type RangeSel = 'live' | HistoryRange | 'custom';

const RANGE_MS: Record<HistoryRange, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  '1y': 365 * DAY_MS,
  '3y': 3 * 365 * DAY_MS,
};

/**
 * Traffic graph: live in/out rates from 5s counter reads, seeded with the
 * server's recent raw readings so it draws on arrival, or history ranges
 * from the backend sampler. Compare lays a second picked period over the
 * view, start on start.
 */
export function InterfaceTraffic({
  switchId,
  ifaceId,
  path,
}: {
  switchId: string;
  ifaceId: string;
  path: string;
}) {
  const [samples, setSamples] = useState<TrafficSample[]>([]);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [seedEarliest, setSeedEarliest] = useState<string | null>(null);
  const tickRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let dead = false;
    let fails = 0;
    setSamples([]);
    setLiveError(null);
    api
      .ifaceSamples(switchId, ifaceId, LIVE_WINDOW_MS / 60_000)
      .then((res) => {
        if (dead) return;
        setSeedEarliest(res.earliest);
        setSamples((prev) => mergeSamples(res.samples, prev, Date.now() - LIVE_WINDOW_MS));
      })
      .catch(() => {
        /* no seed: live ticks still build the graph */
      });
    async function tick() {
      try {
        const res = await api.query<Record<string, unknown>>(switchId, path);
        if (dead) return;
        fails = 0;
        setLiveError(null);
        const inB = counterOf(res.data, 'link/stats/in-bytes');
        const outB = counterOf(res.data, 'link/stats/out-bytes');
        if (inB === undefined || outB === undefined) return;
        const sample: TrafficSample = {
          t: Date.now(),
          inB,
          outB,
          inP: counterOf(res.data, 'link/stats/in-pkts'),
          outP: counterOf(res.data, 'link/stats/out-pkts'),
          dr: sumOf(res.data, 'link/stats/in-drops', 'link/stats/out-drops'),
          er: sumOf(res.data, 'link/stats/in-errors', 'link/stats/out-errors'),
        };
        setSamples((prev) => mergeSamples(prev, [sample], sample.t - LIVE_WINDOW_MS));
      } catch (err) {
        if (dead) return;
        fails++;
        if (fails >= LIVE_FAILS_TO_SHOW)
          setLiveError(err instanceof Error ? err.message : 'switch read failed');
      }
    }
    tickRef.current = () => void tick();
    void tick();
    const id = setInterval(tick, SAMPLE_INTERVAL_MS);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [switchId, ifaceId, path]);

  const [range, setRange] = useState<RangeSel>('live');
  const [metric, setMetric] = useState<'bytes' | 'packets'>('bytes');
  const [custom, setCustom] = useState<Period | null>(null);
  const [compare, setCompare] = useState<Period | null>(null);
  // Period modal: 'range' sets the view (one step); 'compare' sets the
  // baseline (step 1) then what to compare it to (step 2).
  const [picker, setPicker] = useState<{ mode: 'range' | 'compare'; step: 1 | 2 } | null>(null);
  const [kind, setKind] = useState<PeriodKind>('hour');
  const [draftA, setDraftA] = useState<Period | null>(null);
  const [draftB, setDraftB] = useState<Period | null>(null);
  const history = useQuery({
    queryKey: ['traffic-history', switchId, ifaceId, range, custom, metric],
    queryFn: () =>
      api.history(switchId, ifaceId, {
        range: range === 'custom' ? '24h' : range,
        ...(custom && range === 'custom'
          ? { from: new Date(custom.from).toISOString(), to: new Date(custom.to).toISOString() }
          : {}),
        metric,
      }),
    enabled: range !== 'live',
    staleTime: 60_000,
  });

  // Current view window; the comparison period is moved onto its start.
  const nowMin = Math.floor(Date.now() / 60_000) * 60_000;
  const baseFrom =
    range === 'live'
      ? nowMin - LIVE_WINDOW_MS
      : range === 'custom' && custom
        ? custom.from
        : nowMin - RANGE_MS[range === 'custom' ? '24h' : range];
  const baseTo = range === 'custom' && custom ? custom.to : nowMin;
  const offsetMs = compare ? baseFrom - compare.from : 0;
  const compareHistory = useQuery({
    queryKey: ['traffic-compare', switchId, ifaceId, compare, metric],
    queryFn: () =>
      api.history(switchId, ifaceId, {
        from: new Date(compare?.from ?? 0).toISOString(),
        to: new Date(compare?.to ?? 0).toISOString(),
        metric,
      }),
    enabled: compare !== null,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const earliestIso = history.data?.earliest ?? compareHistory.data?.earliest ?? seedEarliest;
  const earliest = earliestIso ? Date.parse(earliestIso) : null;
  // Hours this port actually has history for; pickers only offer those.
  const coverage = useQuery({
    queryKey: ['traffic-coverage', switchId, ifaceId],
    queryFn: () => api.ifaceCoverage(switchId, ifaceId),
    staleTime: 60_000,
  });
  const spans: Period[] = (coverage.data?.spans ?? []).map((s) => ({
    from: Date.parse(s.from),
    to: Date.parse(s.to),
  }));
  const pickMax = Date.now();
  // Coverage may land after the modal opened; seed the default then.
  const coverageReady = coverage.data !== undefined;
  useEffect(() => {
    if (picker && coverageReady && draftA === null) setDraftA(defaultPeriod(kind, Date.now(), spans));
  }, [picker, coverageReady]);

  function openPicker(mode: 'range' | 'compare') {
    let k = kind;
    let a: Period | null = null;
    if (custom && range === 'custom') {
      const len = custom.to - custom.from;
      k = len === HOUR_MS ? 'hour' : dayStart(custom.from, 1) === custom.to ? 'day' : 'range';
      a = custom;
    }
    setKind(k);
    setDraftA(a ?? defaultPeriod(k, Date.now(), spans));
    setDraftB(
      mode === 'compare' && compare && a && compare.to - compare.from === a.to - a.from ? compare : null,
    );
    setPicker({ mode, step: 1 });
  }

  function chooseKind(k: PeriodKind) {
    setKind(k);
    setDraftA(defaultPeriod(k, Date.now(), spans));
    setDraftB(null);
  }

  /** One-click comparison targets for the baseline, limited to ones with history. */
  function quickPicks(a: Period): Array<{ label: string; period: Period }> {
    const days = Math.max(1, Math.round((a.to - a.from) / DAY_MS));
    const back = (n: number): Period =>
      kind === 'hour'
        ? { from: a.from - n * DAY_MS, to: a.to - n * DAY_MS }
        : { from: dayStart(a.from, -n), to: dayStart(a.from, days - n) };
    const picks =
      kind === 'hour'
        ? [
            { label: 'Hour before', period: { from: a.from - HOUR_MS, to: a.from } },
            { label: 'Same hour yesterday', period: back(1) },
            { label: 'Same hour last week', period: back(7) },
          ]
        : kind === 'day'
          ? [
              { label: 'Day before', period: back(1) },
              { label: 'Same day last week', period: back(7) },
            ]
          : [
              { label: `${days} days before`, period: back(days) },
              ...(days < 7 ? [{ label: 'Week before', period: back(7) }] : []),
            ];
    return picks.filter((q) => q.period.from < pickMax && covered(q.period, spans));
  }

  function nextStep() {
    if (!draftA) return;
    if (!draftB || draftB.to - draftB.from !== draftA.to - draftA.from) {
      setDraftB(quickPicks(draftA)[0]?.period ?? null);
    }
    setPicker({ mode: 'compare', step: 2 });
  }

  function applyPicker() {
    if (!picker || !draftA) return;
    if (picker.mode === 'compare') {
      if (!draftB) return;
      setCompare(draftB);
    }
    setCustom(draftA);
    setRange('custom');
    setPicker(null);
  }

  // History answers bytes per second; the graph speaks bits per second like live.
  const scale = metric === 'bytes' ? 8 : 1;

  function livePoints(): Array<{ t: number; In: number; Out: number }> {
    const pts: Array<{ t: number; In: number; Out: number }> = [];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1];
      const b = samples[i];
      if (!a || !b) continue;
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0) continue;
      let inRate: number;
      let outRate: number;
      if (metric === 'packets') {
        if (a.inP === undefined || b.inP === undefined || a.outP === undefined || b.outP === undefined) {
          continue;
        }
        inRate = (b.inP - a.inP) / dt;
        outRate = (b.outP - a.outP) / dt;
      } else {
        inRate = ((b.inB - a.inB) * 8) / dt;
        outRate = ((b.outB - a.outB) * 8) / dt;
      }
      if (inRate < 0 || outRate < 0) continue;
      pts.push({ t: b.t, In: Math.round(inRate * 10) / 10, Out: Math.round(outRate * 10) / 10 });
    }
    return pts;
  }

  const bps = (v: number) => `${packets(v)}bps`;
  const pps = (v: number) => `${packets(v)}pps`;

  const span = Math.max(baseTo - baseFrom, compare ? compare.to - compare.from : 0);
  function fmtTick(ms: number): string {
    const d = new Date(ms);
    return range === 'live' || span <= 2 * DAY_MS
      ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function fmtWhen(ms: number): string {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      ...(range === 'live' ? { second: '2-digit' } : {}),
    });
  }
  const basePoints =
    range === 'live'
      ? livePoints()
      : (history.data?.points ?? []).map((pt) => ({
          t: Date.parse(pt.t),
          In: pt.in * scale,
          Out: pt.out * scale,
        }));
  const comparePoints = (compareHistory.data?.points ?? []).map((pt) => ({
    t: Date.parse(pt.t),
    In: pt.in * scale,
    Out: pt.out * scale,
  }));
  const points = compare ? overlayCompare(basePoints, comparePoints, offsetMs) : basePoints;
  const compareLabel = compare ? spanLabel(compare.from, compare.to) : '';
  const recordingNote = earliest !== null ? ` — recording began ${fmtWhen(earliest)}` : '';
  const unit = metric === 'packets' ? pps : bps;
  const hasCompare = comparePoints.length > 0;
  const hasOut = hasCompare || points.some((pt) => (pt.Out ?? 0) > 0);
  // Series names carry their period so the legend tells baseline from comparison.
  const baseLabel = compare && custom && range === 'custom' ? ` · ${spanLabel(custom.from, custom.to)}` : '';
  const historyError = range !== 'live' && history.isError ? 'History unavailable for this range.' : null;
  const compareNote = !compare
    ? null
    : compareHistory.isError
      ? 'Comparison unavailable.'
      : compareHistory.isPending
        ? 'Loading comparison…'
        : !hasCompare
          ? `No history for ${compareLabel}${recordingNote}.`
          : range !== 'live' && !history.isPending && basePoints.length === 0
            ? `No history for the baseline${baseLabel.replace(' ·', '')}${recordingNote}.`
            : null;

  const dropPoints: Array<{ t: number; Drops: number; Errors: number }> = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b || a.dr === undefined || b.dr === undefined || a.er === undefined || b.er === undefined) {
      continue;
    }
    const dt = (b.t - a.t) / 1000;
    const drops = (b.dr - a.dr) / dt;
    const errors = (b.er - a.er) / dt;
    if (dt <= 0 || drops < 0 || errors < 0) continue;
    dropPoints.push({ t: b.t, Drops: Math.round(drops * 10) / 10, Errors: Math.round(errors * 10) / 10 });
  }

  const loadingHistory = range !== 'live' && history.isPending;
  const showLiveError = range === 'live' && liveError !== null;
  const timeAxis = {
    dataKey: 't',
    type: 'number' as const,
    scale: 'time' as const,
    domain: ['dataMin', 'dataMax'] as [string, string],
    tick: { fontSize: 11, fill: 'var(--color-muted)' },
    minTickGap: 40,
  };
  return (
    <>
      <div style={{ marginTop: 12 }}>
        <Card
          title="Traffic"
          info="This port's bits (or packets) per second, received (In) and sent (Out). Compare draws a second period you pick as dashed lines over the view, start lined up with start."
          actions={
            <span style={{ display: 'flex', gap: 8 }}>
              <SelectMenu
                label="Metric"
                value={metric}
                options={[
                  { value: 'bytes', label: 'Bytes' },
                  { value: 'packets', label: 'Packets' },
                ]}
                onChange={(v) => setMetric(v as 'bytes' | 'packets')}
                width={130}
              />
              <SelectMenu
                label="Range"
                value={range}
                options={[
                  { value: 'live', label: 'Live' },
                  { value: '24h', label: '24h' },
                  { value: '7d', label: '7d' },
                  { value: '30d', label: '30d' },
                  { value: '1y', label: '1y' },
                  { value: '3y', label: '3y' },
                  {
                    value: 'custom',
                    label: custom ? spanLabel(custom.from, custom.to) : 'Custom…',
                  },
                ]}
                onChange={(v) => {
                  if (v === 'custom') openPicker('range');
                  else setRange(v as 'live' | HistoryRange);
                }}
                width={130}
              />
              <Button auto variant="secondary" onClick={() => openPicker('compare')}>
                {compare ? `vs ${compareLabel}` : 'Compare'}
              </Button>
              {compare && (
                <Button auto variant="secondary" onClick={() => setCompare(null)}>
                  Hide compare
                </Button>
              )}
            </span>
          }
        >
          {historyError ? (
            <Alert tone="fail">{historyError}</Alert>
          ) : loadingHistory ? (
            <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Loading history…</p>
          ) : points.length === 0 ? (
            showLiveError ? null : (
              <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>
                {range === 'live'
                  ? 'Collecting live samples every 5 seconds — the graph appears after the second one.'
                  : `No samples in this range${recordingNote || ' yet — the sampler backfills from here'}.`}
              </p>
            )
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
                  <XAxis {...timeAxis} tickFormatter={(v) => fmtTick(Number(v))} />
                  <YAxis
                    tickFormatter={(v) => unit(Number(v))}
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
                    labelFormatter={(v) =>
                      compare
                        ? `${fmtWhen(Number(v))}  ·  vs ${fmtWhen(Number(v) - offsetMs)}`
                        : fmtWhen(Number(v))
                    }
                    formatter={(v) => unit(typeof v === 'number' ? v : Number(v))}
                  />
                  <Area
                    type="monotone"
                    dataKey="In"
                    name={`In${baseLabel}`}
                    stroke="var(--color-pass)"
                    strokeWidth={2}
                    fill="url(#trafficInFill)"
                    connectNulls
                  />
                  {hasOut && (
                    <Area
                      type="monotone"
                      dataKey="Out"
                      name={`Out${baseLabel}`}
                      stroke="var(--color-brand)"
                      strokeWidth={2}
                      fill="url(#trafficOutFill)"
                      connectNulls
                    />
                  )}
                  {hasCompare && (
                    <Line
                      type="monotone"
                      dataKey="InB"
                      connectNulls
                      name={`In · ${compareLabel}`}
                      stroke="var(--color-compare-in)"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      dot={false}
                    />
                  )}
                  {hasCompare && (
                    <Line
                      type="monotone"
                      dataKey="OutB"
                      connectNulls
                      name={`Out · ${compareLabel}`}
                      stroke="var(--color-compare-out)"
                      strokeWidth={2}
                      strokeDasharray="6 4"
                      dot={false}
                    />
                  )}
                  <Legend
                    wrapperStyle={{ fontSize: 13, color: 'var(--color-muted)' }}
                    itemSorter={(item) => ['In', 'Out', 'InB', 'OutB'].indexOf(String(item.dataKey))}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
          {compareNote && (
            <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '8px 0 0' }}>{compareNote}</p>
          )}
          {showLiveError && (
            <div style={{ marginTop: points.length === 0 ? 0 : 12 }}>
              <ReadError switchId={switchId} message={liveError} onFixed={() => tickRef.current()} />
            </div>
          )}
        </Card>
      </div>
      <Modal
        open={picker !== null}
        onClose={() => setPicker(null)}
        title={picker?.mode === 'compare' ? 'Compare' : 'Custom range'}
      >
        {picker?.step === 2 && draftA ? (
          <>
            <PickerCaption text="Step 2 of 2 · Compare to" />
            {quickPicks(draftA).length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {quickPicks(draftA).map((q) => {
                  const on = draftB?.from === q.period.from && draftB.to === q.period.to;
                  return (
                    <button
                      key={q.label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDraftB(q.period)}
                      style={{
                        background: 'var(--color-surface-2)',
                        border: `1px solid ${on ? 'var(--color-brand)' : 'var(--color-border)'}`,
                        borderRadius: 8,
                        color: on ? 'var(--color-text)' : 'var(--color-muted)',
                        cursor: 'pointer',
                        font: 'inherit',
                        fontSize: 13,
                        padding: '5px 10px',
                      }}
                    >
                      {q.label}
                    </button>
                  );
                })}
              </div>
            )}
            <PeriodPicker
              key="compare-to"
              kind={kind}
              value={draftB}
              onChange={setDraftB}
              spans={spans}
              max={pickMax}
              lengthMs={draftA.to - draftA.from}
            />
          </>
        ) : (
          <>
            {picker?.mode === 'compare' && <PickerCaption text="Step 1 of 2 · Baseline" />}
            <Tabs
              tabs={[
                { id: 'hour', label: 'Hour' },
                { id: 'day', label: 'Day' },
                { id: 'range', label: 'Range' },
              ]}
              active={kind}
              onChange={(id) => chooseKind(id as PeriodKind)}
            />
            <PeriodPicker
              key={`baseline-${kind}`}
              kind={kind}
              value={draftA}
              onChange={setDraftA}
              spans={spans}
              max={pickMax}
            />
          </>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
          {picker?.step === 2 ? (
            <Button auto variant="secondary" onClick={() => setPicker({ mode: 'compare', step: 1 })}>
              Back
            </Button>
          ) : (
            <Button auto variant="secondary" onClick={() => setPicker(null)}>
              Cancel
            </Button>
          )}
          {picker?.mode === 'compare' && picker.step === 1 ? (
            <Button auto disabled={!draftA} onClick={nextStep}>
              Next
            </Button>
          ) : (
            <Button auto disabled={!draftA || (picker?.mode === 'compare' && !draftB)} onClick={applyPicker}>
              {picker?.mode === 'compare' ? 'Compare' : 'Show range'}
            </Button>
          )}
        </div>
      </Modal>
      <div style={{ marginTop: 12 }}>
        <Card title="Discards & errors">
          {dropPoints.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>
              Drop and error rates appear here once samples accumulate — flat zero means a clean port.
            </p>
          ) : (
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dropPoints} margin={{ left: 8, right: 8 }}>
                  <defs>
                    <linearGradient id="dropFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-fail)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-fail)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="errFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-warn)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-warn)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    {...timeAxis}
                    tickFormatter={(v) =>
                      new Date(Number(v)).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    }
                  />
                  <YAxis
                    tickFormatter={(v) => pps(Number(v))}
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
                    labelFormatter={(v) =>
                      new Date(Number(v)).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    }
                    formatter={(v) => pps(typeof v === 'number' ? v : Number(v))}
                  />
                  <Area
                    type="monotone"
                    dataKey="Drops"
                    stroke="var(--color-fail)"
                    strokeWidth={2}
                    fill="url(#dropFill)"
                  />
                  <Area
                    type="monotone"
                    dataKey="Errors"
                    stroke="var(--color-warn)"
                    strokeWidth={2}
                    fill="url(#errFill)"
                  />
                  <Legend wrapperStyle={{ fontSize: 13, color: 'var(--color-muted)' }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

/** Small uppercase section label inside the period picker. */
function PickerCaption({ text }: { text: string }) {
  return (
    <p
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--color-muted)',
        margin: '12px 0 4px',
      }}
    >
      {text}
    </p>
  );
}
