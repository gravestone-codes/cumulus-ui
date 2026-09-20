/**
 * Switch home: landing for a chosen switch inside the app shell.
 * Domain cards link into slices; unsliced domains arrive per roadmap order.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { AppShell, Button, NavRail } from '../components/ui.js';
import { switchNav } from '../lib/nav.js';

export function SwitchHome() {
  const { switchId = '' } = useParams();
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
          switchName={switchId}
          items={switchNav(switchId)}
          active={`/switches/${switchId}`}
          onNav={navigate}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
        />
      }
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>{switchId}</h1>
      <p style={{ color: 'var(--color-muted)', fontSize: 14, margin: '0 0 20px' }}>
        Pick a domain. Every value on these screens is read live from the switch.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button auto onClick={() => navigate(`/switches/${switchId}/interfaces`)}>
          Interfaces
        </Button>
      </div>
    </AppShell>
  );
}
