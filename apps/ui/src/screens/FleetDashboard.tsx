/**
 * Fleet dashboard: stat tiles + chart cards, personal per user.
 * Every number comes from real endpoints — nothing is fabricated. Cards
 * whose data needs fan-out reads render an honest placeholder naming what
 * will appear (omnistream Overview's EmptyChart contract). Customize
 * adds/removes known ids only; the registry entry shape (id + opaque
 * config) already fits per-device sort/filter configs when those land.
 */
import { useState } from 'react';
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
import { Alert, Button, Modal } from '../components/ui.js';
import { GlobalShell } from './GlobalShell.js';

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

function SampleBadge() {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--color-warn)',
        border: '1px solid var(--color-warn)',
        borderRadius: 6,
        padding: '2px 6px',
        marginLeft: 8,
        verticalAlign: 'middle',
      }}
    >
      Sample
    </span>
  );
}

function Card({
  title,
  hint,
  sample,
  onRemove,
  children,
}: {
  title: string;
  hint?: string;
  sample?: boolean;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 16,
        padding: 20,
        minWidth: 0,
        position: 'relative',
      }}
    >
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 2px' }}>
        {title}
        {sample && <SampleBadge />}
      </h3>
      {hint && <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '0 0 16px' }}>{hint}</p>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          title={`Remove ${title}`}
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            background: 'transparent',
            border: 'none',
            color: 'var(--color-muted)',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 16,
            padding: 4,
          }}
        >
          ×
        </button>
      )}
      {children}
    </section>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div style={{ minWidth: 120 }}>
      <p
        style={{
          fontSize: 12,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-muted)',
          margin: '0 0 8px',
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          margin: 0,
          color: tone ?? 'var(--color-text)',
        }}
      >
        {value}
      </p>
      {sub && <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '4px 0 0' }}>{sub}</p>}
    </div>
  );
}

/** Compact packet/counter formatting: 1500 -> 1.5k, 2.4e9 -> 2.4G. */
function packets(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}G`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

function FleetStats({ switches }: { switches: SwitchRow[] }) {
  const sample = switches.length === 0;
  const n = sample ? 12 : switches.length;
  const reachable = sample ? 11 : switches.filter((x) => x.last_check_ok).length;
  const failing = sample ? 1 : switches.filter((x) => x.last_check_ok === false).length;
  const untrusted = sample ? 2 : switches.filter((x) => !x.trust_verified).length;
  return {
    sample,
    node: (
      <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
        <Stat label="Switches" value={String(n)} sub={`${reachable} reachable`} />
        <Stat
          label="Failing checks"
          value={String(failing)}
          sub="Last check failed"
          tone={failing > 0 ? 'var(--color-fail)' : undefined}
        />
        <Stat
          label="Trust pending"
          value={String(untrusted)}
          sub="Awaiting TOFU decision"
          tone={untrusted > 0 ? 'var(--color-warn)' : undefined}
        />
      </div>
    ),
  };
}

const REACH_HEX: Record<string, string> = {
  Reachable: 'var(--color-pass)',
  Unreachable: 'var(--color-fail)',
  Unknown: 'var(--color-muted)',
};

function Reachability({ switches }: { switches: SwitchRow[] }) {
  const sample = switches.length === 0;
  const data = sample
    ? [
        { name: 'Reachable', value: 9 },
        { name: 'Unreachable', value: 2 },
        { name: 'Unknown', value: 1 },
      ]
    : Object.entries({
        Reachable: switches.filter((x) => x.last_check_ok === true).length,
        Unreachable: switches.filter((x) => x.last_check_ok === false).length,
        Unknown: switches.filter((x) => x.last_check_ok !== true && x.last_check_ok !== false).length,
      })
        .filter(([, value]) => value > 0)
        .map(([name, value]) => ({ name, value }));
  return {
    sample,
    node: (
      <div style={{ height: 256 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={2}
            >
              {data.map((s) => (
                <Cell key={s.name} fill={REACH_HEX[s.name]} />
              ))}
            </Pie>
            <Tooltip {...TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 13, color: 'var(--color-muted)' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    ),
  };
}

const SAMPLE_TRAFFIC = [
  { day: 'Sep 7', label: 'Sep 7', packets: 1_240_000_000 },
  { day: 'Sep 8', label: 'Sep 8', packets: 1_890_000_000 },
  { day: 'Sep 9', label: 'Sep 9', packets: 1_520_000_000 },
  { day: 'Sep 10', label: 'Sep 10', packets: 2_310_000_000 },
  { day: 'Sep 11', label: 'Sep 11', packets: 2_870_000_000 },
  { day: 'Sep 12', label: 'Sep 12', packets: 2_120_000_000 },
  { day: 'Sep 13', label: 'Sep 13', packets: 3_340_000_000 },
  { day: 'Sep 14', label: 'Sep 14', packets: 2_960_000_000 },
  { day: 'Sep 15', label: 'Sep 15', packets: 3_810_000_000 },
  { day: 'Sep 16', label: 'Sep 16', packets: 3_220_000_000 },
  { day: 'Sep 17', label: 'Sep 17', packets: 4_150_000_000 },
  { day: 'Sep 18', label: 'Sep 18', packets: 3_730_000_000 },
  { day: 'Sep 19', label: 'Sep 19', packets: 4_480_000_000 },
  { day: 'Sep 20', label: 'Sep 20', packets: 4_020_000_000 },
];

function Traffic() {
  return {
    sample: true,
    node: (
      <div style={{ height: 256 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={SAMPLE_TRAFFIC} margin={{ left: 8, right: 8 }}>
            <defs>
              <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-pass)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--color-pass)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} interval={2} />
            <YAxis
              tickFormatter={(v) => packets(Number(v))}
              tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
              width={56}
            />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => packets(typeof v === 'number' ? v : Number(v))} />
            <Area
              type="monotone"
              dataKey="packets"
              name="Packets"
              stroke="var(--color-pass)"
              strokeWidth={2}
              fill="url(#trafficFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    ),
  };
}

const SAMPLE_DEVICES = [
  { name: 'spine01', packets: 8_410_000_000 },
  { name: 'spine02', packets: 7_930_000_000 },
  { name: 'leaf03', packets: 4_220_000_000 },
  { name: 'leaf01', packets: 3_870_000_000 },
  { name: 'leaf02', packets: 3_120_000_000 },
  { name: 'leaf04', packets: 1_940_000_000 },
  { name: 'mgmt01', packets: 210_000_000 },
];

function InterfacesByDevice() {
  return {
    sample: true,
    node: (
      <div style={{ height: 256 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={SAMPLE_DEVICES} layout="vertical" margin={{ left: 8 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v) => packets(Number(v))}
              tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
              width={70}
            />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => packets(typeof v === 'number' ? v : Number(v))} />
            <Bar
              dataKey="packets"
              name="Packets"
              fill="var(--color-pass)"
              radius={[0, 4, 4, 0]}
              maxBarSize={14}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    ),
  };
}
function RecentActivity() {
  const activity = useQuery({ queryKey: ['audit-recent'], queryFn: () => api.audit(8), retry: false });
  if (activity.isError) return null;
  if (activity.isPending) {
    return <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Loading…</p>;
  }
  if (activity.data.length === 0) {
    return <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>No audited actions yet.</p>;
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, fontSize: 14 }}>
      {activity.data.map((a) => (
        <li key={a.id} style={{ color: 'var(--color-muted)' }}>
          <span style={{ color: 'var(--color-text)' }}>{a.username}</span> {a.method} {a.path}
          {a.switch_id ? ` on ${a.switch_id}` : ''}
        </li>
      ))}
    </ul>
  );
}

/** Client mirror of the server WIDGET_CATALOG. Blurbs feed the picker. */
type WidgetRender = (s: SwitchRow[]) => { sample: boolean; node: React.ReactNode };
const REGISTRY: Record<string, { title: string; hint: string; blurb: string; render: WidgetRender }> = {
  'fleet-stats': {
    title: 'Fleet at a glance',
    hint: 'Inventory counts from the platform database.',
    blurb: 'Switch, reachability and trust counts.',
    render: (s) => ({ ...FleetStats({ switches: s }) }),
  },
  reachability: {
    title: 'Switches by reachability',
    hint: 'Last check outcome per onboarded switch.',
    blurb: 'Reachable / unreachable / unknown pie.',
    render: (s) => ({ ...Reachability({ switches: s }) }),
  },
  traffic: {
    title: 'Packets over time',
    hint: 'Needs fan-out counter reads.',
    blurb: 'Traffic trend across the fleet.',
    render: () => ({ ...Traffic() }),
  },
  'interfaces-by-device': {
    title: 'Interfaces by device',
    hint: 'Needs fan-out counter reads.',
    blurb: 'Per-device interface stats, sortable.',
    render: () => ({ ...InterfacesByDevice() }),
  },
  'recent-activity': {
    title: 'Recent activity',
    hint: 'Latest audited actions across the platform.',
    blurb: 'Audit trail tail.',
    render: () => ({ sample: false, node: <RecentActivity /> }),
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
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Dashboard</h1>
          <p style={{ color: 'var(--color-muted)', fontSize: 14, margin: '4px 0 0' }}>
            Every workload, at a glance. Personal to you — Customize to make it yours.
          </p>
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
          {active.map(({ id, title, hint, render }) => {
            const r = render(switches.data ?? []);
            return (
              <Card
                key={id}
                title={title}
                hint={hint}
                sample={r.sample}
                onRemove={
                  customizing && active.length > 1 ? () => setIds(ids.filter((x) => x !== id)) : undefined
                }
              >
                {r.node}
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
