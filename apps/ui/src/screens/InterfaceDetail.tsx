/**
 * Interface detail (3A.2): one port's live values. Field set follows the
 * official API reference leaf schemas (link/state, link/speed, link/mtu,
 * link/mac-address, ip/vrf) — not guesses. Edit arrives in 3A.7.
 */
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { AppShell, Breadcrumb, NavRail, usePinnedRail } from '../components/ui.js';
import { Card, Stat, StatRow, packets } from '../components/cards.js';
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
      <InterfaceStats switchId={switchId} path={`/interface/${ifaceId}`} />
    </AppShell>
  );
}

/** Parse a counter that arrives as a number or a human string ("11.96 KB"). */
function counterOf(obj: Record<string, unknown>, path: string): number | undefined {
  const v = getPath(obj, path);
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const m = v.match(/^([\d.]+)\s*([KMGT]?B)?/i);
    if (!m) return undefined;
    const mult = { '': 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 } as Record<string, number>;
    const unit = (m[2] ?? '').toUpperCase();
    return Number(m[1]) * (mult[unit] ?? 1);
  }
  return undefined;
}

function sumOf(obj: Record<string, unknown>, ...paths: string[]): number | undefined {
  let total = 0;
  let seen = false;
  for (const p of paths) {
    const v = counterOf(obj, p);
    if (v !== undefined) {
      total += v;
      seen = true;
    }
  }
  return seen ? total : undefined;
}

const statText = (v: number | undefined, fmt: (n: number) => string) => (v === undefined ? '—' : fmt(v));

/**
 * Statistics card: every counter the port exposes (`link/stats/*` per the
 * reference), read from the same cached detail object — no second fetch.
 * EtHTool depth + clear action arrive with 3A.4.
 */
function InterfaceStats({ switchId, path }: { switchId: string; path: string }) {
  const detail = useQuery({
    queryKey: ['resource-obj', switchId, path],
    queryFn: () => api.query<Record<string, unknown>>(switchId, path),
    retry: false,
    staleTime: 30_000,
  });
  if (detail.isPending || detail.isError || !detail.data) return null;
  const o = detail.data.data;
  return (
    <div style={{ marginTop: 12 }}>
      <Card title="Statistics">
        <StatRow>
          <Stat label="In packets" value={statText(counterOf(o, 'link/stats/in-pkts'), packets)} />
          <Stat label="Out packets" value={statText(counterOf(o, 'link/stats/out-pkts'), packets)} />
          <Stat label="In bytes" value={statText(counterOf(o, 'link/stats/in-bytes'), packets)} />
          <Stat label="Out bytes" value={statText(counterOf(o, 'link/stats/out-bytes'), packets)} />
        </StatRow>
        <div style={{ marginTop: 16 }}>
          <StatRow>
            <Stat
              label="Drops"
              value={statText(sumOf(o, 'link/stats/in-drops', 'link/stats/out-drops'), packets)}
            />
            <Stat
              label="Errors"
              value={statText(sumOf(o, 'link/stats/in-errors', 'link/stats/out-errors'), packets)}
            />
            <Stat
              label="Carrier transitions"
              value={statText(counterOf(o, 'link/stats/carrier-transitions'), packets)}
            />
          </StatRow>
        </div>
      </Card>
    </div>
  );
}
