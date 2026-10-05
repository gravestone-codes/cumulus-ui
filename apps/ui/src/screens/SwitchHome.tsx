/**
 * Switch home: the switch landing. Navigation lives in the rail; this page
 * carries only the title, the unfinished-onboarding banner, and the trust
 * state. Removal lives in the Switches table row menu.
 */
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Alert, AppShell, NavRail, usePinnedRail } from '../components/ui.js';
import { switchNav } from '../lib/nav.js';

export function SwitchHome() {
  const { switchId = '' } = useParams();
  const navigate = useNavigate();
  const [collapsed, toggleCollapsed] = usePinnedRail('scope');
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  const row = (switches.data ?? []).find((s) => s.id === switchId);
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
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 16px' }}>{switchId}</h1>
      {row && !row.trust_verified && (
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
      )}
    </AppShell>
  );
}
