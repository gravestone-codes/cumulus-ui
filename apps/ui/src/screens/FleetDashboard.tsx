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
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
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

function Card({
  title,
  hint,
  onRemove,
  children,
}: {
  title: string;
  hint?: string;
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
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 2px' }}>{title}</h3>
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

function EmptyChart({ label }: { label: string }) {
  return (
    <div
      style={{
        height: 256,
        display: 'grid',
        placeItems: 'center',
        border: '1px dashed var(--color-border)',
        borderRadius: 12,
        color: 'var(--color-muted)',
        fontSize: 14,
        textAlign: 'center',
        padding: 16,
      }}
    >
      {label}
    </div>
  );
}

function FleetStats({ switches }: { switches: SwitchRow[] }) {
  const reachable = switches.filter((s) => s.last_check_ok).length;
  const failing = switches.filter((s) => s.last_check_ok === false).length;
  const untrusted = switches.filter((s) => !s.trust_verified).length;
  return (
    <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
      <Stat label="Switches" value={String(switches.length)} sub={`${reachable} reachable`} />
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
  );
}

const REACH_HEX: Record<string, string> = {
  Reachable: 'var(--color-pass)',
  Unreachable: 'var(--color-fail)',
  Unknown: 'var(--color-muted)',
};

function Reachability({ switches }: { switches: SwitchRow[] }) {
  const counts = { Reachable: 0, Unreachable: 0, Unknown: 0 };
  switches.forEach((s) => {
    if (s.last_check_ok === true) counts.Reachable++;
    else if (s.last_check_ok === false) counts.Unreachable++;
    else counts.Unknown++;
  });
  const data = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([name, value]) => ({ name, value }));
  if (data.length === 0) return <EmptyChart label="No switches onboarded yet." />;
  return (
    <div style={{ height: 256 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
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

function Traffic() {
  return (
    <EmptyChart label="Packet counters over time land with fan-out reads. Onboard switches first, then watch this space." />
  );
}

function InterfacesByDevice() {
  return (
    <EmptyChart label="Per-device interface stats land with fan-out reads — sortable per device, biggest talkers first." />
  );
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
const REGISTRY: Record<
  string,
  { title: string; hint: string; blurb: string; render: (s: SwitchRow[]) => React.ReactNode }
> = {
  'fleet-stats': {
    title: 'Fleet at a glance',
    hint: 'Inventory counts from the platform database.',
    blurb: 'Switch, reachability and trust counts.',
    render: (s) => <FleetStats switches={s} />,
  },
  reachability: {
    title: 'Switches by reachability',
    hint: 'Last check outcome per onboarded switch.',
    blurb: 'Reachable / unreachable / unknown pie.',
    render: (s) => <Reachability switches={s} />,
  },
  traffic: {
    title: 'Packets over time',
    hint: 'Needs fan-out counter reads.',
    blurb: 'Traffic trend across the fleet.',
    render: () => <Traffic />,
  },
  'interfaces-by-device': {
    title: 'Interfaces by device',
    hint: 'Needs fan-out counter reads.',
    blurb: 'Per-device interface stats, sortable.',
    render: () => <InterfacesByDevice />,
  },
  'recent-activity': {
    title: 'Recent activity',
    hint: 'Latest audited actions across the platform.',
    blurb: 'Audit trail tail.',
    render: () => <RecentActivity />,
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
          {active.map(({ id, title, hint, render }) => (
            <Card
              key={id}
              title={title}
              hint={hint}
              onRemove={
                customizing && active.length > 1 ? () => setIds(ids.filter((x) => x !== id)) : undefined
              }
            >
              {render(switches.data)}
            </Card>
          ))}
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
