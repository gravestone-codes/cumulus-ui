/**
 * Switch home: trust banner and read errors over the switch's personal,
 * customizable Dashboard (scope switch) — health, CPU, memory, ports,
 * errors, environment, software, connection, traffic with compare. Every
 * number is live.
 */
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Alert, AppShell, NavRail, Spinner, usePinnedRail } from '../components/ui.js';
import { ReadError } from '../components/resource.js';
import { switchNav } from '../lib/nav.js';
import { ifaceQuery } from '../lib/vitals.js';
import { Dashboard } from './dashboard/Dashboard.js';

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
      {switches.isPending ? (
        <Spinner label="Loading switch" />
      ) : (
        <Dashboard scope="switch" switches={row ? [row] : []} title={switchId} hint="This switch, live.">
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
        </Dashboard>
      )}
    </AppShell>
  );
}
