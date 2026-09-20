/**
 * Fleet dashboard: at-a-glance platform state. Widgets are a registry
 * (WIDGETS below) rendered in order — user widget prefs (add/remove/reorder)
 * arrive as a prefs endpoint + picker and only filter this list, no rewrite.
 * Admin-only widgets hide on 403 instead of erroring.
 */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { SwitchRow } from '../lib/api.js';
import { Alert, Button } from '../components/ui.js';
import { GlobalShell } from './GlobalShell.js';

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        padding: 16,
        minWidth: 0,
      }}
    >
      <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-muted)', margin: '0 0 12px' }}>
        {title}
      </h2>
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
    <Card title="Fleet health">
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        {stats.map(([label, n, color]) => (
          <div key={label}>
            <div style={{ fontSize: 26, fontWeight: 800, color }}>{n}</div>
            <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{label}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function NeedsAttention({ switches }: { switches: SwitchRow[] }) {
  const navigate = useNavigate();
  const flagged = switches.filter((s) => !s.trust_verified || s.last_check_ok === false);
  return (
    <Card title="Needs attention">
      {flagged.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0 }}>Everything checks out.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {flagged.map((s) => (
            <li key={s.id} style={{ fontSize: 13 }}>
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
      )}
    </Card>
  );
}

function RecentActivity() {
  const activity = useQuery({ queryKey: ['audit-recent'], queryFn: () => api.audit(8), retry: false });
  if (activity.isError) return null;
  return (
    <Card title="Recent activity">
      {activity.isPending ? (
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0 }}>Loading…</p>
      ) : activity.data.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0 }}>No audited actions yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, fontSize: 13 }}>
          {activity.data.map((a) => (
            <li key={a.id} style={{ color: 'var(--color-muted)' }}>
              <span style={{ color: 'var(--color-text)' }}>{a.username}</span> {a.method} {a.path}
              {a.switch_id ? ` on ${a.switch_id}` : ''}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const WIDGETS: Array<(switches: SwitchRow[]) => React.ReactNode> = [
  (s) => <FleetHealth key="health" switches={s} />,
  (s) => <NeedsAttention key="attention" switches={s} />,
];

export function FleetDashboard() {
  const navigate = useNavigate();
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  return (
    <GlobalShell active="/dashboard">
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 16px' }}>Dashboard</h1>
      {switches.isError && <Alert tone="fail">Could not load switches: {switches.error.message}</Alert>}
      {switches.data && (
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}
        >
          {WIDGETS.map((render) => render(switches.data))}
          <RecentActivity />
        </div>
      )}
      {switches.data?.length === 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          <Button auto onClick={() => navigate('/switches/new')}>
            Onboard a switch
          </Button>
          <Button auto variant="secondary" onClick={() => navigate('/switches/bulk')}>
            Bulk import
          </Button>
        </div>
      )}
    </GlobalShell>
  );
}
