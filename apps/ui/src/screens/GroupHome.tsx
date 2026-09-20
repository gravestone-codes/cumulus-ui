/**
 * Group home: the switch menu scoped to every member. Domain items enable
 * as fan-out reads land; until then the guardrail contract is stated here:
 * group-safe paths apply everywhere, per-switch-unique ones (interface IPs,
 * MACs, BGP router-ids, hostnames) are refused group-wide.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Alert, AppShell, NavRail } from '../components/ui.js';
import { groupNav } from '../lib/nav.js';

const UNIQUE_EXAMPLES = 'interface IPs, MAC addresses, BGP router-ids, hostnames';

export function GroupHome() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  const members = (switches.data ?? []).filter((s) => s.groups.includes(groupId));
  async function logout() {
    await api.logout();
    navigate('/login', { replace: true });
  }
  return (
    <AppShell
      rail={
        <NavRail
          switchName={`Group ${groupId} · ${members.length} member${members.length === 1 ? '' : 's'}`}
          items={groupNav(groupId)}
          active={`/groups/${groupId}`}
          onNav={navigate}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
      }
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>{groupId}</h1>
      <p style={{ color: 'var(--color-muted)', fontSize: 14, margin: '0 0 16px' }}>
        Group scope: one change fans out to every member. Group-safe paths (NTP, DNS, syslog, VLANs) apply
        everywhere; per-switch-unique paths ({UNIQUE_EXAMPLES}) are refused here — change those per switch.
      </p>
      {switches.isError && <Alert tone="fail">Could not load switches: {switches.error.message}</Alert>}
      {!switches.isPending && members.length === 0 && (
        <Alert tone="warn">No switches belong to this group yet. Assign some during onboarding.</Alert>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {members.map((m) => (
          <li key={m.id} style={{ fontSize: 15 }}>
            <button
              type="button"
              onClick={() => navigate(`/switches/${m.id}`)}
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
              {m.display_name || m.id}
            </button>{' '}
            <span style={{ color: 'var(--color-muted)', fontSize: 14 }}>
              {m.trust_verified ? '' : 'trust pending'}
            </span>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
