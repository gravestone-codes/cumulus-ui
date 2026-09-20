/**
 * GlobalShell: the always-mounted app frame (Dashboard / Switches /
 * Software). Owns collapse state, session and logout once — global screens
 * mount inside, never beside. Switch-scoped screens use their own rail.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { AppShell, NavRail } from '../components/ui.js';
import { globalNav } from '../lib/nav.js';

export function GlobalShell({ active, children }: { active: string; children: ReactNode }) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  async function logout() {
    await api.logout();
    navigate('/login', { replace: true });
  }
  return (
    <AppShell
      rail={
        <NavRail
          items={globalNav()}
          active={active}
          onNav={navigate}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
      }
    >
      {children}
    </AppShell>
  );
}
