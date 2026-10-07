/**
 * App shell for interface screens in either scope: the switch rail or the
 * group rail, same pages inside. Keeps scope wiring out of every screen.
 */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { AppShell, NavRail, usePinnedRail } from '../../components/ui.js';
import { groupNav, switchNav } from '../../lib/nav.js';
import { scopeBase, type Scope } from './scope.js';

export function ScopeShell({
  scope,
  active,
  children,
}: {
  scope: Scope;
  active: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [collapsed, toggleCollapsed] = usePinnedRail('scope');
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  async function logout() {
    await api.logout();
    navigate('/login', { replace: true });
  }
  const group = scope.kind === 'group';
  return (
    <AppShell
      rail={
        <NavRail
          brand={false}
          back={group ? { label: 'Groups', to: '/groups' } : { label: 'Switches', to: '/switches' }}
          scope={{ kind: scope.kind, name: scope.id }}
          items={group ? groupNav(scope.id) : switchNav(scope.id)}
          active={`${scopeBase(scope)}${active}`}
          onNav={navigate}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
        />
      }
    >
      {children}
    </AppShell>
  );
}
