/**
 * Group statistics (design §2A + pick): one interface across members.
 * Stat row sums the group; the chart is the group sum or one line per
 * switch; every switch is a chip that hides/shows it (in sums too). The
 * per-switch table names the outlier. Same live/history sources as the
 * single-switch graph, fanned out per member.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../lib/api.js';
import { Alert, SelectMenu } from '../../components/ui.js';
import { Card, Stat, StatRow, packets } from '../../components/cards.js';
import { DataTable, type GridColumn } from '../../components/DataTable.js';
import {
  mergeSamples,
  perSwitchRows,
  samplesToRates,
  sumSeries,
  type RatePoint,
  type TrafficSample,
} from '../../lib/traffic.js';
import { firstDefined, ifaceState, timeAgo } from '../../lib/format.js';
import { counterOf, sumOf } from './Traffic.js';

const SAMPLE_INTERVAL_MS = 5000;
const LIVE_WINDOW_MS = 15 * 60_000;
const DAY_MS = 86_400_000;
type RangeSel = 'live' | '24h' | '7d' | '30d' | '1y' | '3y';
const RANGE_MS: Record<Exclude<RangeSel, 'live'>, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  '1y': 365 * DAY_MS,
  '3y': 3 * 365 * DAY_MS,
};
/** Series colour follows the switch's position in the group, never its rank in the view. */
export const seriesColor = (i: number) => `var(--color-series-${(i % 8) + 1})`;

type Obj = Record<string, unknown> | undefined;

function sampleOf(o: Record<string, unknown>, t: number): TrafficSample | null {
  const inB = counterOf(o, 'link/stats/in-bytes');
  const outB = counterOf(o, 'link/stats/out-bytes');
  if (inB === undefined || outB === undefined) return null;
  return {
    t,
    inB,
    outB,
    inP: counterOf(o, 'link/stats/in-pkts'),
    outP: counterOf(o, 'link/stats/out-pkts'),
    dr: sumOf(o, 'link/stats/in-drops', 'link/stats/out-drops'),
    er: sumOf(o, 'link/stats/in-errors', 'link/stats/out-errors'),
  };
}

export function GroupTraffic({
  groupId,
  ifaceId,
  members,
  present,
  oper,
}: {
  groupId: string;
  ifaceId: string;
  /** Every group member, in stable order (colours key off this). */
  members: string[];
  present: string[];
  oper: Record<string, Obj>;
}) {
  const navigate = useNavigate();
  const [range, setRange] = useState<RangeSel>('live');
  const [metric, setMetric] = useState<'bytes' | 'packets'>('bytes');
  const [mode, setMode] = useState<'sum' | 'per'>('sum');
  const [dir, setDir] = useState<'in' | 'out'>('in');
  const [hidden, setHidden] = useState<string[]>([]);
  const [samples, setSamples] = useState<Record<string, TrafficSample[]>>({});
  const [liveError, setLiveError] = useState<string | null>(null);
  const presentKey = present.join(',');

  // Live: seed each member from the server, then one fan-out read every 5s.
  useEffect(() => {
    let dead = false;
    setSamples({});
    const since = () => Date.now() - LIVE_WINDOW_MS;
    for (const sw of present) {
      api
        .ifaceSamples(sw, ifaceId, LIVE_WINDOW_MS / 60_000)
        .then((res) => {
          if (!dead) setSamples((p) => ({ ...p, [sw]: mergeSamples(res.samples, p[sw] ?? [], since()) }));
        })
        .catch(() => undefined);
    }
    async function tick() {
      try {
        const res = await api.groupQuery<Record<string, unknown>>(groupId, `/interface/${ifaceId}`);
        if (dead) return;
        setLiveError(null);
        const t = Date.now();
        setSamples((prev) => {
          const next = { ...prev };
          for (const r of res.results) {
            const s = r.ok && r.data ? sampleOf(r.data, t) : null;
            if (s) next[r.switchId] = mergeSamples(prev[r.switchId] ?? [], [s], t - LIVE_WINDOW_MS);
          }
          return next;
        });
      } catch (err) {
        if (!dead) setLiveError(err instanceof Error ? err.message : 'group read failed');
      }
    }
    void tick();
    const id = setInterval(tick, SAMPLE_INTERVAL_MS);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [groupId, ifaceId, presentKey]);

  const history = useQueries({
    queries: present.map((sw) => ({
      queryKey: ['traffic-history', sw, ifaceId, range, null, metric],
      queryFn: () => api.history(sw, ifaceId, { range: range === 'live' ? '24h' : range, metric }),
      enabled: range !== 'live',
      staleTime: 60_000,
    })),
  });

  const scale = metric === 'bytes' ? 8 : 1;
  const series: Record<string, RatePoint[]> = Object.fromEntries(
    present.map((sw, i) => [
      sw,
      range === 'live'
        ? samplesToRates(samples[sw] ?? [], metric)
        : (history[i]?.data?.points ?? []).map((p) => ({
            t: Date.parse(p.t),
            in: p.in * scale,
            out: p.out * scale,
          })),
    ]),
  );
  const visible = present.filter((sw) => !hidden.includes(sw));
  const step = range === 'live' ? 10_000 : Math.max(60_000, Math.round(RANGE_MS[range] / 360));
  const sumPoints = sumSeries(series, visible, step);
  const perPoints = perSwitchRows(series, visible, dir, step);
  const unit = (v: number) => `${packets(v)}${metric === 'packets' ? 'pps' : 'bps'}`;
  // Switch counters refresh slower than the 5s reads, so single deltas flicker
  // to zero: the "now" figure is the mean of the last minute of points.
  const latest = (sw: string): RatePoint | undefined => {
    const pts = series[sw] ?? [];
    const last = pts[pts.length - 1];
    if (!last || range !== 'live') return last;
    const recent = pts.filter((p) => p.t >= last.t - 60_000);
    return {
      t: last.t,
      in: recent.reduce((a, p) => a + p.in, 0) / recent.length,
      out: recent.reduce((a, p) => a + p.out, 0) / recent.length,
    };
  };
  const loadingHistory = range !== 'live' && history.some((h) => h.isPending);

  // Totals over visible switches.
  const inSum = visible.reduce((a, sw) => a + (latest(sw)?.in ?? 0), 0);
  const outSum = visible.reduce((a, sw) => a + (latest(sw)?.out ?? 0), 0);
  const errs = present.map((sw) => ({
    sw,
    n: oper[sw] ? (sumOf(oper[sw], 'link/stats/in-errors', 'link/stats/out-errors') ?? 0) : 0,
  }));
  const errTotal = errs.reduce((a, e) => a + e.n, 0);
  const worst = [...errs].sort((a, b) => b.n - a.n)[0];
  const up = present.filter((sw) => ifaceState(oper[sw]) === 'up').length;

  const toggle = (sw: string) => setHidden((h) => (h.includes(sw) ? h.filter((x) => x !== sw) : [...h, sw]));

  const timeAxis = {
    dataKey: 't',
    type: 'number' as const,
    scale: 'time' as const,
    domain: ['dataMin', 'dataMax'] as [string, string],
    tick: { fontSize: 11, fill: 'var(--color-muted)' },
    minTickGap: 40,
    tickFormatter: (v: number) =>
      range === 'live' || range === '24h'
        ? new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        : new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  };
  const tooltip = {
    contentStyle: {
      background: 'var(--color-surface)',
      border: '1px solid var(--color-border)',
      borderRadius: 12,
      fontSize: 13,
    },
    labelStyle: { color: 'var(--color-text)', fontWeight: 600, marginBottom: 2 },
    itemStyle: { color: 'var(--color-text)' },
    labelFormatter: (v: unknown) => new Date(Number(v)).toLocaleString(),
    formatter: (v: unknown) => unit(Number(v)),
  };

  type Row = { sw: string };
  const cols: GridColumn<Row>[] = [
    {
      key: 'sw',
      label: 'Switch',
      always: true,
      value: (r) => r.sw,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{ width: 10, height: 3, borderRadius: 2, background: seriesColor(members.indexOf(r.sw)) }}
          />
          {r.sw}
        </span>
      ),
    },
    { key: 'state', label: 'State', value: (r) => ifaceState(oper[r.sw]) ?? '—' },
    { key: 'in', label: 'In', value: (r) => (latest(r.sw) ? unit(latest(r.sw)!.in) : '—') },
    { key: 'out', label: 'Out', value: (r) => (latest(r.sw) ? unit(latest(r.sw)!.out) : '—') },
    {
      key: 'drops',
      label: 'Drops',
      value: (r) => {
        const v = oper[r.sw] ? sumOf(oper[r.sw]!, 'link/stats/in-drops', 'link/stats/out-drops') : undefined;
        return v === undefined ? '—' : packets(v);
      },
    },
    {
      key: 'errors',
      label: 'Errors',
      value: (r) => {
        const v = oper[r.sw]
          ? sumOf(oper[r.sw]!, 'link/stats/in-errors', 'link/stats/out-errors')
          : undefined;
        return v === undefined ? '—' : packets(v);
      },
    },
    {
      key: 'change',
      label: 'Last change',
      // NVUE reports local switch time as "2026/10/05 13:41:33.121".
      value: (r) => {
        const raw = firstDefined(oper[r.sw], 'link/oper-status-last-change');
        return raw ? timeAgo(raw.replace(/\//g, '-').replace(' ', 'T')) : '—';
      },
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card title="Statistics">
        <StatRow columns={4}>
          <Stat
            label={`In (${visible.length === present.length ? 'sum' : `${visible.length} of ${present.length}`})`}
            value={unit(inSum)}
          />
          <Stat
            label={`Out (${visible.length === present.length ? 'sum' : `${visible.length} of ${present.length}`})`}
            value={unit(outSum)}
          />
          <Stat
            label="Errors"
            value={packets(errTotal)}
            sub={errTotal > 0 && worst ? `most on ${worst.sw}` : undefined}
            tone={errTotal > 0 ? 'var(--color-fail)' : undefined}
          />
          <Stat label="Up" value={`${up}/${present.length}`} />
        </StatRow>
      </Card>
      <Card
        title="Traffic"
        info="Bits (or packets) per second across the group. Sum adds the shown switches; Per switch draws one line each. Click a switch to hide or show it."
        actions={
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <SelectMenu
              label="View"
              value={mode}
              options={[
                { value: 'sum', label: 'Sum' },
                { value: 'per', label: 'Per switch' },
              ]}
              onChange={(v) => setMode(v as 'sum' | 'per')}
              width={130}
            />
            {mode === 'per' && (
              <SelectMenu
                label="Direction"
                value={dir}
                options={[
                  { value: 'in', label: 'In' },
                  { value: 'out', label: 'Out' },
                ]}
                onChange={(v) => setDir(v as 'in' | 'out')}
                width={110}
              />
            )}
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
              options={(['live', '24h', '7d', '30d', '1y', '3y'] as const).map((r) => ({
                value: r,
                label: r === 'live' ? 'Live' : r,
              }))}
              onChange={(v) => setRange(v as RangeSel)}
              width={110}
            />
          </span>
        }
      >
        <div
          role="group"
          aria-label="Switches in the graph"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}
        >
          {present.map((sw) => {
            const on = !hidden.includes(sw);
            return (
              <button
                key={sw}
                type="button"
                aria-pressed={on}
                title={on ? `Hide ${sw}` : `Show ${sw}`}
                onClick={() => toggle(sw)}
                className="chip"
                style={{ opacity: on ? 1 : 0.45, textDecoration: on ? 'none' : 'line-through' }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: on ? seriesColor(members.indexOf(sw)) : 'var(--color-border)',
                  }}
                />
                {sw}
              </button>
            );
          })}
        </div>
        {liveError && range === 'live' && <Alert tone="fail">{liveError}</Alert>}
        {visible.length === 0 ? (
          <p style={muted}>Every switch is hidden — click one above to show it.</p>
        ) : loadingHistory ? (
          <p style={muted}>Loading history…</p>
        ) : (mode === 'sum' ? sumPoints : perPoints).length === 0 ? (
          <p style={muted}>
            {range === 'live'
              ? 'Collecting live samples every 5 seconds — the graph appears after the second one.'
              : 'No samples in this range yet.'}
          </p>
        ) : (
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              {mode === 'sum' ? (
                <AreaChart data={sumPoints} margin={{ left: 8, right: 8 }}>
                  <defs>
                    <linearGradient id="gInFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-pass)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-pass)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gOutFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis {...timeAxis} />
                  <YAxis
                    tickFormatter={(v) => unit(Number(v))}
                    tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
                    width={64}
                  />
                  <Tooltip {...tooltip} cursor={{ stroke: 'var(--color-muted)', strokeOpacity: 0.4 }} />
                  <Area
                    type="monotone"
                    dataKey="In"
                    stroke="var(--color-pass)"
                    strokeWidth={2}
                    fill="url(#gInFill)"
                  />
                  <Area
                    type="monotone"
                    dataKey="Out"
                    stroke="var(--color-brand)"
                    strokeWidth={2}
                    fill="url(#gOutFill)"
                  />
                  <Legend wrapperStyle={{ fontSize: 13, color: 'var(--color-muted)' }} />
                </AreaChart>
              ) : (
                <LineChart data={perPoints} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis {...timeAxis} />
                  <YAxis
                    tickFormatter={(v) => unit(Number(v))}
                    tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
                    width={64}
                  />
                  <Tooltip {...tooltip} cursor={{ stroke: 'var(--color-muted)', strokeOpacity: 0.4 }} />
                  {visible.map((sw) => (
                    <Line
                      key={sw}
                      type="monotone"
                      dataKey={sw}
                      name={`${sw} · ${dir}`}
                      stroke={seriesColor(members.indexOf(sw))}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        )}
      </Card>
      <Card title="Per switch">
        <DataTable<Row>
          cols={cols}
          rows={present.map((sw) => ({ sw }))}
          storageKey="cumulus.group-iface-stats.v1"
          onRowClick={(r) =>
            navigate(`/switches/${encodeURIComponent(r.sw)}/interfaces/${encodeURIComponent(ifaceId)}`)
          }
        />
      </Card>
    </div>
  );
}

const muted: React.CSSProperties = { fontSize: 14, color: 'var(--color-muted)', margin: 0 };
