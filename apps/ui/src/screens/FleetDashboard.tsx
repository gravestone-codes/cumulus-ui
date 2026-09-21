/**
 * Fleet dashboard: at-a-glance platform state, personal per user.
 * Widgets are a client registry rendered in the order the backend prefs
 * dictate; Customize adds/removes known ids only (the server rejects the
 * rest). Packet/throughput widgets arrive with fan-out reads — the registry
 * entry shape (id + opaque config) already fits them.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { SwitchRow } from '../lib/api.js';
import { Alert, Button, Modal } from '../components/ui.js';
import { GlobalShell } from './GlobalShell.js';

function Card({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        padding: 16,
        minWidth: 0,
        position: 'relative',
      }}
    >
      <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-muted)', margin: '0 0 12px' }}>
        {title}
      </h2>
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
            fontSize: 15,
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

function FleetHealth({ switches }: { switches: SwitchRow[] }) {
  const reachable = switches.filter((s) => s.last_check_ok).length;
  const failing = switches.filter((s) => s.last_check_ok === false).length;
  const untrusted = switches.filter((s) => !s.trust_verified).length;
  const stats: Array<[string, number, string]> = [
    ['Switches', switches.length, 'var(--color-text)'],
    ['Reachable', reachable, 'var(--color-pass)'],
    ['Failing checks', failing, failing > 0 ? 'var(--color-fail)' : 'var(--color-muted)'],
    ['Trust pending', untrusted, untrusted > 0 ? 'var(--color-warn)' : 'var(--color-muted)'],
  ];
  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      {stats.map(([label, n, color]) => (
        <div key={label}>
          <div style={{ fontSize: 26, fontWeight: 800, color }}>{n}</div>
          <div style={{ fontSize: 13, color: 'var(--color-muted)' }}>{label}</div>
        </div>
      ))}
    </div>
  );
}

function NeedsAttention({ switches }: { switches: SwitchRow[] }) {
  const navigate = useNavigate();
  const flagged = switches.filter((s) => !s.trust_verified || s.last_check_ok === false);
  if (flagged.length === 0) {
    return <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Everything checks out.</p>;
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {flagged.map((s) => (
        <li key={s.id} style={{ fontSize: 14 }}>
          <button
            type="button"
            onClick={() => navigate(`/switches/${s.id}`)}
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
            {s.display_name || s.id}
          </button>{' '}
          <span style={{ color: 'var(--color-muted)' }}>
            {!s.trust_verified ? 'trust pending' : 'last check failed'}
          </span>
        </li>
      ))}
    </ul>
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

/** Client mirror of the server WIDGET_CATALOG. Descriptions feed the picker. */
const REGISTRY: Record<
  string,
  { title: string; blurb: string; render: (s: SwitchRow[]) => React.ReactNode }
> = {
  'fleet-health': {
    title: 'Fleet health',
    blurb: 'Switch, reachability and trust counts.',
    render: (s) => <FleetHealth switches={s} />,
  },
  'needs-attention': {
    title: 'Needs attention',
    blurb: 'Switches failing checks or awaiting trust.',
    render: (s) => <NeedsAttention switches={s} />,
  },
  'recent-activity': {
    title: 'Recent activity',
    blurb: 'Latest audited actions across the platform.',
    render: () => <RecentActivity />,
  },
};

export function FleetDashboard() {
  const navigate = useNavigate();
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
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Dashboard</h1>
        <span style={{ flex: 1 }} />
        <Button auto variant="secondary" onClick={() => setCustomizing((c) => !c)}>
          {customizing ? 'Done' : 'Customize'}
        </Button>
      </div>
      {switches.isError && <Alert tone="fail">Could not load switches: {switches.error.message}</Alert>}
      {switches.data && (
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}
        >
          {active.map(({ id, title, render }) => (
            <Card
              key={id}
              title={title}
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
      {switches.data?.length === 0 && !customizing && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <Button auto onClick={() => navigate('/switches/new')}>
            Onboard a switch
          </Button>
          <Button auto variant="secondary" onClick={() => navigate('/switches/bulk')}>
            Bulk import
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
