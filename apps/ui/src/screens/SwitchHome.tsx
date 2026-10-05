/**
 * Switch home: title, trust banner, and the switch's own metric widgets —
 * interface counts, liveness, recent activity, traffic placeholder. Same
 * Card/Stat language as the fleet dashboard; every number is live.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Alert, AppShell, Button, NavRail, ReconnectModal, usePinnedRail } from '../components/ui.js';
import { Card, Stat, StatRow } from '../components/cards.js';
import { ActivityList } from '../components/activity.js';
import { timeAgo } from '../lib/format.js';
import { switchNav } from '../lib/nav.js';

export function SwitchHome() {
  const { switchId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const [reconnectOpen, setReconnectOpen] = useState(false);
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
        <Card title="Interfaces">
          {ifaces.isError ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <p style={{ fontSize: 14, color: 'var(--color-fail)', margin: 0 }}>
                Unreadable: {ifaces.error.message}
              </p>
              <div>
                <Button auto variant="secondary" onClick={() => setReconnectOpen(true)}>
                  Reconnect switch
                </Button>
              </div>
            </div>
          ) : ifaces.isPending ? (
            <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Loading…</p>
          ) : (
            <StatRow>
              <Stat label="Total" value={String(entries.length)} />
              <Stat label="Up" value={String(up)} tone={up > 0 ? 'var(--color-pass)' : undefined} />
              <Stat label="Down / other" value={String(entries.length - up)} />
            </StatRow>
          )}
        </Card>
        <Card title="Health">
          <StatRow>
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
          </StatRow>
        </Card>
        <Card title="Recent activity">
          {activity.isError ? null : activity.isPending ? (
            <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Loading…</p>
          ) : (
            <ActivityList rows={activity.data} onOpen={() => navigate(`/switches/${switchId}/audit`)} />
          )}
        </Card>
        <Card title="Packets over time">
          <div
            style={{
              minHeight: 120,
              display: 'flex',
              alignItems: 'center',
              color: 'var(--color-muted)',
              fontSize: 14,
            }}
          >
            Live packet trend for this switch arrives with fan-out counter reads.
          </div>
        </Card>
      </div>
      <ReconnectModal
        switchId={switchId}
        open={reconnectOpen}
        onClose={() => setReconnectOpen(false)}
        onDone={() => {
          queryClient.invalidateQueries({ queryKey: ['resource', switchId] });
          queryClient.invalidateQueries({ queryKey: ['switches'] });
        }}
      />
    </AppShell>
  );
}
