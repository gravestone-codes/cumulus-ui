/**
 * Interface detail (3A.2): one port's live values. Field set follows the
 * official API reference leaf schemas (link/state, link/speed, link/mtu,
 * link/mac-address, ip/vrf) — not guesses. Edit arrives in 3A.7.
 */
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { AppShell, Breadcrumb, NavRail, usePinnedRail } from '../components/ui.js';
import { ResourceDetail } from '../components/resource.js';
import { firstDefined, getPath } from '../lib/format.js';
import { switchNav } from '../lib/nav.js';

const text = (v: unknown) => (typeof v === 'string' && v !== '' ? v : '—');

export function InterfaceDetail() {
  const { switchId = '', ifaceId = '' } = useParams();
  const navigate = useNavigate();
  const [collapsed, toggleCollapsed] = usePinnedRail('scope');
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
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
          active={`/switches/${switchId}/interfaces`}
          onNav={navigate}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
        />
      }
    >
      <Breadcrumb
        trail={[
          { label: switchId, to: `/switches/${switchId}` },
          { label: 'Interfaces', to: `/switches/${switchId}/interfaces` },
          { label: ifaceId },
        ]}
        onNav={navigate}
      />
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 12px' }}>{ifaceId}</h1>
      <ResourceDetail
        switchId={switchId}
        path={`/interface/${ifaceId}`}
        fields={[
          { label: 'State', value: (o) => firstDefined(o, 'link/state', 'link/oper-status') ?? '—' },
          { label: 'Admin status', value: (o) => text(getPath(o, 'link/admin-status')) },
          { label: 'Speed', value: (o) => text(getPath(o, 'link/speed')) },
          { label: 'MTU', value: (o) => text(getPath(o, 'link/mtu')) },
          { label: 'MAC address', value: (o) => text(getPath(o, 'link/mac-address')) },
          { label: 'Description', value: (o) => text(getPath(o, 'description')) },
          { label: 'VRF', value: (o) => text(getPath(o, 'ip/vrf')) },
          { label: 'Type', value: (o) => text(getPath(o, 'type')) },
        ]}
      />
    </AppShell>
  );
}
