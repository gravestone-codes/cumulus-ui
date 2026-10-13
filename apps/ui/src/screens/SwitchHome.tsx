/**
 * Switch home: title, trust banner, and the switch's own widgets — health,
 * load, ports, errors, environment, software, activity — from the shared
 * widget library, plus connection state and switch-wide traffic (live,
 * ranges, compare). Every number is live.
 */
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Alert, AppShell, NavRail, usePinnedRail } from '../components/ui.js';
import { Card, Facts } from '../components/cards.js';
import { ReadError } from '../components/resource.js';
import { timeAgo } from '../lib/format.js';
import { switchNav } from '../lib/nav.js';
import { ifaceQuery } from '../lib/vitals.js';
import { WidgetGrid } from './dashboard/widgets.js';
import { TrafficPanel } from './iface/Traffic.js';

/** Host[:port] of the switch API URL; the full URL stays in the tooltip. */
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Switch home widgets: verdict first, then load and ports, then detail. */
const SWITCH_WIDGETS = [
  'software',
  'health',
  'resources',
  'port-status',
  'environment',
  'interface-errors',
  'top-talkers',
  'recent-activity',
];

export function SwitchHome() {
  const { switchId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsed, toggleCollapsed] = usePinnedRail('scope');
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  const row = (switches.data ?? []).find((s) => s.id === switchId);
  // Shared with the port widgets: a failed read here offers reconnect inline.
  const ifaces = useQuery(ifaceQuery(switchId));
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
          active={`/switches/${switchId}`}
          onNav={navigate}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
        />
      }
    >
      <div className="list-head">
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{switchId}</h1>
      </div>
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
      {ifaces.isError && (
        <div style={{ marginBottom: 12 }}>
          <ReadError
            switchId={switchId}
            message={ifaces.error.message}
            onFixed={() => {
              queryClient.invalidateQueries({ queryKey: ['resource', switchId] });
              queryClient.invalidateQueries({ queryKey: ['vitals', switchId] });
              queryClient.invalidateQueries({ queryKey: ['switches'] });
            }}
          />
        </div>
      )}
      <WidgetGrid ids={SWITCH_WIDGETS} switches={row ? [row] : []}>
        <div style={{ minWidth: 0, display: 'grid' }}>
          <Card title="Connection">
            <Facts
              items={[
                {
                  label: 'Trust',
                  value: row ? (row.trust_verified ? 'Verified' : 'Pending') : '—',
                  tone: row?.trust_verified ? 'var(--color-pass)' : 'var(--color-warn)',
                },
                {
                  label: 'Reachable',
                  value:
                    row?.last_check_ok === true ? 'Yes' : row?.last_check_ok === false ? 'No' : 'Unknown',
                  tone:
                    row?.last_check_ok === true
                      ? 'var(--color-pass)'
                      : row?.last_check_ok === false
                        ? 'var(--color-fail)'
                        : undefined,
                },
                { label: 'Last seen', value: timeAgo(row?.last_seen_at) },
                { label: 'Last checked', value: timeAgo(row?.last_check_at) },
                { label: 'Address', value: row ? hostOf(row.base_url) : '—', title: row?.base_url },
                { label: 'Groups', value: row && row.groups.length > 0 ? row.groups.join(', ') : 'none' },
              ]}
            />
          </Card>
        </div>
        <div className="wide" style={{ minWidth: 0 }}>
          <TrafficPanel
            embedded
            initialRange="24h"
            switchId={switchId}
            title="Traffic over time"
            info="All of this switch's interfaces added together: bits (or packets) per second received (In) and sent (Out). A frame crossing the switch counts once in and once out. Compare draws a second period you pick as dashed lines over the view, start lined up with start."
          />
        </div>
      </WidgetGrid>
    </AppShell>
  );
}
