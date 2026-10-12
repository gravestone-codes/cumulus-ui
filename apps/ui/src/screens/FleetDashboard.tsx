/**
 * Fleet dashboard: stat tiles + chart cards, personal per user.
 * Every number comes from real endpoints — nothing is fabricated. Cards
 * whose data needs fan-out reads render an honest placeholder naming what
 * will appear (omnistream Overview's EmptyChart contract). Customize
 * adds/removes known ids only; the registry entry shape (id + opaque
 * config) already fits per-device sort/filter configs when those land.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api.js';
import type { SwitchRow } from '../lib/api.js';
import { Alert, Button, Hint, Modal } from '../components/ui.js';
import { GlobalShell } from './GlobalShell.js';
import { Card, Stat, StatRow, packets } from '../components/cards.js';
import { ActivityList } from '../components/activity.js';

const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    fontSize: 13,
  },
  labelStyle: { color: 'var(--color-text)', fontWeight: 600, marginBottom: 2 },
  itemStyle: { color: 'var(--color-text)' },
  cursor: { fill: 'var(--color-muted)', fillOpacity: 0.07 },
};

function FleetStatsCard({ switches }: { switches: SwitchRow[] }) {
  const n = switches.length;
  const reachable = switches.filter((x) => x.last_check_ok).length;
  const failing = switches.filter((x) => x.last_check_ok === false).length;
  const untrusted = switches.filter((x) => !x.trust_verified).length;
  return (
    <StatRow columns={2}>
      <Stat label="Switches" value={String(n)} sub={`${reachable} reachable`} />
      <Stat
        label="Failing"
        value={String(failing)}
        sub="Last check failed"
        tone={failing > 0 ? 'var(--color-fail)' : undefined}
      />
      <Stat
        label="Untrusted"
        value={String(untrusted)}
        sub="Awaiting TOFU decision"
        tone={untrusted > 0 ? 'var(--color-warn)' : undefined}
      />
    </StatRow>
  );
}

const REACH_HEX: Record<string, string> = {
  Reachable: 'var(--color-pass)',
  Unreachable: 'var(--color-fail)',
  Unknown: 'var(--color-muted)',
};

function ReachabilityCard({ switches }: { switches: SwitchRow[] }) {
  const data = Object.entries({
    Reachable: switches.filter((x) => x.last_check_ok === true).length,
    Unreachable: switches.filter((x) => x.last_check_ok === false).length,
    Unknown: switches.filter((x) => x.last_check_ok !== true && x.last_check_ok !== false).length,
  })
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));
  if (data.length === 0) {
    return <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>No switches yet.</p>;
  }
  return (
    <div style={{ height: 208 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={64} outerRadius={80} paddingAngle={3}>
            {data.map((s) => (
              <Cell key={s.name} fill={REACH_HEX[s.name]} />
            ))}
          </Pie>
          <Tooltip {...TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 13, color: 'var(--color-muted)' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Fleet traffic: every member's switch-wide sampler series summed per tick
 * (bytes → bits). Real endpoints only — no fabricated series. Empty when the
 * sampler has nothing yet.
 */
function TrafficCard({ switches }: { switches: SwitchRow[] }) {
  const traffic = useQuery({
    queryKey: [
      'fleet-traffic',
      switches
        .map((s) => s.id)
        .sort()
        .join(','),
    ],
    queryFn: async () => {
      const per = await Promise.all(
        switches.map((s) => api.switchTraffic(s.id, { range: '24h', metric: 'bytes' }).catch(() => null)),
      );
      const byTick = new Map<string, { t: string; in: number; out: number }>();
      for (const r of per) {
        for (const p of r?.points ?? []) {
          const cur = byTick.get(p.t) ?? { t: p.t, in: 0, out: 0 };
          cur.in += p.in;
          cur.out += p.out;
          byTick.set(p.t, cur);
        }
      }
      return [...byTick.values()].sort((a, b) => (a.t < b.t ? -1 : 1));
    },
    enabled: switches.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  if (switches.length === 0) {
    return <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>No switches yet.</p>;
  }
  if (traffic.isPending) {
    return <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Loading…</p>;
  }
  const points = (traffic.data ?? []).map((p) => ({
    label: new Date(p.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    In: p.in * 8,
    Out: p.out * 8,
  }));
  if (points.length === 0) {
    return (
      <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>
        No samples in this range yet — the sampler backfills from here.
      </p>
    );
  }
  const bps = (v: number) => `${packets(v)}bps`;
  return (
    <div style={{ height: 256 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ left: 8, right: 8 }}>
          <defs>
            <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-pass)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-pass)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} minTickGap={40} />
          <YAxis
            tickFormatter={(v) => bps(Number(v))}
            tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
            width={64}
          />
          <Tooltip {...TOOLTIP_STYLE} formatter={(v) => bps(typeof v === 'number' ? v : Number(v))} />
          <Area
            type="monotone"
            dataKey="In"
            name="In"
            stroke="var(--color-pass)"
            strokeWidth={2}
            fill="url(#trafficFill)"
          />
          <Area
            type="monotone"
            dataKey="Out"
            name="Out"
            stroke="var(--color-brand)"
            strokeWidth={2}
            fill="transparent"
          />
          <Legend wrapperStyle={{ fontSize: 13, color: 'var(--color-muted)' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Interfaces by device: real per-switch interface counts via the `small`
 * view (keys only — no per-interface payload). Bars sort descending.
 */
function InterfacesByDeviceCard({ switches }: { switches: SwitchRow[] }) {
  const counts = useQuery({
    queryKey: [
      'fleet-iface-counts',
      switches
        .map((s) => s.id)
        .sort()
        .join(','),
    ],
    queryFn: async () => {
      const per = await Promise.all(
        switches.map(async (s) => {
          try {
            const res = await api.query<Record<string, unknown>>(s.id, '/interface', { view: 'small' });
            return { name: s.display_name || s.id, interfaces: Object.keys(res.data).length };
          } catch {
            return { name: s.display_name || s.id, interfaces: 0 };
          }
        }),
      );
      return per.sort((a, b) => b.interfaces - a.interfaces).slice(0, 12);
    },
    enabled: switches.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  if (switches.length === 0) {
    return <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>No switches yet.</p>;
  }
  if (counts.isPending) {
    return <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Loading…</p>;
  }
  const data = counts.data ?? [];
  if (data.every((d) => d.interfaces === 0)) {
    return (
      <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>
        No interface data — check switch reachability.
      </p>
    );
  }
  return (
    <div style={{ height: 256 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
            width={90}
          />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar
            dataKey="interfaces"
            name="Interfaces"
            fill="var(--color-pass)"
            radius={[0, 4, 4, 0]}
            maxBarSize={14}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function RecentActivityCard() {
  const navigate = useNavigate();
  const activity = useQuery({ queryKey: ['audit-recent'], queryFn: () => api.audit(8), retry: false });
  if (activity.isError) return null;
  if (activity.isPending) {
    return <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Loading…</p>;
  }
  return (
    <ActivityList
      rows={activity.data}
      onOpen={(row) => row.switch_id && navigate(`/switches/${row.switch_id}/audit`)}
    />
  );
}

/**
 * Client mirror of the server WIDGET_CATALOG. Blurbs feed the picker.
 * Widgets are components (never invoked as functions): their hooks must run
 * unconditionally, independent of which widgets are active (React #310).
 * Every widget reads live endpoints — nothing renders fabricated series.
 */
type WidgetComponent = (props: { switches: SwitchRow[] }) => React.ReactNode;
const REGISTRY: Record<
  string,
  { title: string; blurb: string; sample: (s: SwitchRow[]) => boolean; Component: WidgetComponent }
> = {
  'fleet-stats': {
    title: 'Fleet at a glance',
    blurb: 'Switch, reachability and trust counts.',
    sample: () => false,
    Component: FleetStatsCard,
  },
  reachability: {
    title: 'Switches by reachability',
    blurb: 'Reachable / unreachable / unknown pie.',
    sample: () => false,
    Component: ReachabilityCard,
  },
  traffic: {
    title: 'Bits over time (24h)',
    blurb: 'Summed switch-wide sampler series across the fleet.',
    sample: () => false,
    Component: TrafficCard,
  },
  'interfaces-by-device': {
    title: 'Interfaces by device',
    blurb: 'Live interface counts per switch.',
    sample: () => false,
    Component: InterfacesByDeviceCard,
  },
  'recent-activity': {
    title: 'Recent activity',
    blurb: 'Audit trail tail.',
    sample: () => false,
    Component: RecentActivityCard,
  },
};

export function FleetDashboard() {
  const queryClient = useQueryClient();
  const [customizing, setCustomizing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  const prefs = useQuery({ queryKey: ['dashboard-prefs'], queryFn: () => api.dashboard(), retry: false });
  const save = useMutation({
    mutationFn: (widgets: Array<{ id: string }>) => api.saveDashboard(widgets),
    onSuccess: (data) => queryClient.setQueryData(['dashboard-prefs'], data),
  });
  const ids = (prefs.data?.widgets ?? []).map((w) => w.id).filter((id) => REGISTRY[id]);
  const active = ids.flatMap((id) => {
    const entry = REGISTRY[id];
    return entry ? [{ id, ...entry }] : [];
  });
  const missing = Object.keys(REGISTRY).filter((id) => !ids.includes(id));
  const missingEntries = missing.flatMap((id) => {
    const entry = REGISTRY[id];
    return entry ? [{ id, ...entry }] : [];
  });

  function setIds(next: string[]) {
    save.mutate(next.map((id) => ({ id })));
  }

  return (
    <GlobalShell active="/dashboard">
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
            Dashboard
            <Hint text="Every workload, at a glance. Personal to you — Customize to add or remove widgets." />
          </h1>
        </div>
        <span style={{ flex: 1 }} />
        <Button auto variant="secondary" onClick={() => setCustomizing((c) => !c)}>
          {customizing ? 'Done' : 'Customize'}
        </Button>
      </div>
      {switches.isError && <Alert tone="fail">Could not load switches: {switches.error.message}</Alert>}
      {switches.data && (
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}
        >
          {active.map(({ id, title, sample, Component }) => {
            const data = switches.data ?? [];
            return (
              <Card
                key={id}
                title={title}
                sample={sample(data)}
                onRemove={
                  customizing && active.length > 1 ? () => setIds(ids.filter((x) => x !== id)) : undefined
                }
              >
                <Component switches={data} />
              </Card>
            );
          })}
        </div>
      )}
      {customizing && missing.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Button auto variant="secondary" onClick={() => setPickerOpen(true)}>
            Add widget
          </Button>
        </div>
      )}
      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add widget">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {missingEntries.map(({ id, title, blurb }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => {
                  setIds([...ids, id]);
                  setPickerOpen(false);
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                  font: 'inherit',
                  padding: '10px 12px',
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
                <br />
                <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>{blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </GlobalShell>
  );
}
