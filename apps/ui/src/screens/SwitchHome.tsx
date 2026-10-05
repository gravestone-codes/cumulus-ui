/**
 * Switch home: title, trust banner, and the switch's own metric widgets —
 * interface counts, liveness, recent activity, traffic placeholder. Same
 * Card/Stat language as the fleet dashboard; every number is live.
 */
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Alert, AppShell, NavRail, usePinnedRail } from '../components/ui.js';
import { Card, Stat } from '../components/cards.js';
import { switchNav } from '../lib/nav.js';

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

export function SwitchHome() {
  const { switchId = '' } = useParams();
  const navigate = useNavigate();
  const [collapsed, toggleCollapsed] = usePinnedRail('scope');
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  const row = (switches.data ?? []).find((s) => s.id === switchId);
  // Shared cache key with the Interfaces list: one fetch serves both.
  const ifaces = useQuery({
    queryKey: ['resource', switchId, '/interface', undefined],
    queryFn: () => api.query<Record<string, { state?: unknown }>>(switchId, '/interface'),
    retry: false,
  });
  const activity = useQuery({
    queryKey: ['audit-switch', switchId],
    queryFn: () => api.audit(6, switchId),
    retry: false,
  });
  async function logout() {
    await api.logout();
    navigate('/login', { replace: true });
  }
  const entries = ifaces.data ? Object.entries(ifaces.data.data) : [];
  const up = entries.filter(([, v]) => String(v.state ?? '').toLowerCase() === 'up').length;
  return (
    <AppShell
      rail={
        <NavRail
          brand={false}
          back={{ label: 'Switches', to: '/switches' }}
          scope={{ kind: 'switch', name: switchId }}
          items={switchNav(switchId)}
          active={`/switches/${switchId}`}
          onNav={navigate}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
        />
      }
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 16px' }}>{switchId}</h1>
      {row && !row.trust_verified && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="warn">
            Onboarding unfinished: this switch is not trusted yet.{' '}
            <button
              type="button"
              onClick={() => navigate(`/switches/new?resume=${encodeURIComponent(switchId)}`)}
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
              Finish onboarding
            </button>
          </Alert>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
        <Card title="Interfaces" hint="Live from the switch.">
          {ifaces.isError ? (
            <p style={{ fontSize: 14, color: 'var(--color-fail)', margin: 0 }}>
              Unreadable: {ifaces.error.message}
            </p>
          ) : ifaces.isPending ? (
            <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Loading…</p>
          ) : (
            <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
              <Stat label="Total" value={String(entries.length)} />
              <Stat label="Up" value={String(up)} tone={up > 0 ? 'var(--color-pass)' : undefined} />
              <Stat label="Down / other" value={String(entries.length - up)} />
            </div>
          )}
        </Card>
        <Card title="Health" hint="Trust and last check.">
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <Stat
              label="Trust"
              value={row ? (row.trust_verified ? 'Verified' : 'Pending') : '—'}
              tone={row?.trust_verified ? 'var(--color-pass)' : 'var(--color-warn)'}
            />
            <Stat
              label="Reachable"
              value={row?.last_check_ok === true ? 'Yes' : row?.last_check_ok === false ? 'No' : 'Unknown'}
            />
            <Stat label="Last seen" value={timeAgo(row?.last_seen_at)} />
          </div>
        </Card>
        <Card title="Recent activity" hint={`Audited actions on ${switchId}.`}>
          {activity.isError ? null : activity.isPending ? (
            <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Loading…</p>
          ) : activity.data.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Nothing audited here yet.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, fontSize: 14 }}>
              {activity.data.map((a) => (
                <li key={a.id} style={{ color: 'var(--color-muted)' }}>
                  <span style={{ color: 'var(--color-text)' }}>{a.username}</span> {a.method} {a.path}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Packets over time" hint="Per-switch counters land with the traffic series.">
          <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>
            Live packet trend for this switch arrives with fan-out counter reads.
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
