/**
 * Switch home: title, trust banner, and the switch's own widgets — health,
 * load, ports, errors, environment, software, activity — from the shared
 * widget library, plus connection state and ranged traffic. Every number is live.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api.js';
import { Alert, AppShell, NavRail, SelectMenu, usePinnedRail } from '../components/ui.js';
import { Card, Stat, StatRow, packets } from '../components/cards.js';
import { ReadError } from '../components/resource.js';
import { timeAgo } from '../lib/format.js';
import { switchNav } from '../lib/nav.js';
import { ifaceQuery } from '../lib/vitals.js';
import { WidgetGrid } from './dashboard/widgets.js';

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
            <StatRow columns={3}>
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
        </div>
        <div className="wide" style={{ minWidth: 0 }}>
          <Card
            title="Traffic over time"
            info="All of this switch's interfaces added together: bits (or packets) per second received (In) and sent (Out). A frame crossing the switch counts once in and once out. Hover the graph for exact values."
          >
            <SwitchTraffic switchId={switchId} />
          </Card>
        </div>
      </WidgetGrid>
    </AppShell>
  );
}

/**
 * SwitchTraffic: whole-switch bit rates summed across interfaces, with
 * range and metric pickers (24h … 3y). Fills as the sampler backfills.
 */
function SwitchTraffic({ switchId }: { switchId: string }) {
  const bps = (v: number) => `${packets(v)}bps`;
  const pps = (v: number) => `${packets(v)}pps`;
  const [range, setRange] = useState<'24h' | '7d' | '30d' | '1y' | '3y'>('24h');
  const [metric, setMetric] = useState<'bytes' | 'packets'>('bytes');
  const traffic = useQuery({
    queryKey: ['switch-traffic', switchId, range, metric],
    queryFn: () => api.switchTraffic(switchId, { range, metric }),
    staleTime: 60_000,
  });
  const unit = metric === 'packets' ? pps : bps;
  // History answers bytes per second; the graph speaks bits per second.
  const scale = metric === 'bytes' ? 8 : 1;
  const points = (traffic.data?.points ?? []).map((p) => ({
    label:
      range === '24h'
        ? new Date(p.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
        : new Date(p.t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    In: p.in * scale,
    Out: p.out * scale,
  }));
  const hasOut = points.some((p) => p.Out > 0);
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <SelectMenu
          label="Metric"
          value={metric}
          options={[
            { value: 'bytes', label: 'Bytes' },
            { value: 'packets', label: 'Packets' },
          ]}
          onChange={(v) => setMetric(v as 'bytes' | 'packets')}
          width={130}
        />
        <SelectMenu
          label="Range"
          value={range}
          options={[
            { value: '24h', label: '24h' },
            { value: '7d', label: '7d' },
            { value: '30d', label: '30d' },
            { value: '1y', label: '1y' },
            { value: '3y', label: '3y' },
          ]}
          onChange={(v) => setRange(v as '24h' | '7d' | '30d' | '1y' | '3y')}
          width={110}
        />
      </div>
      {traffic.isPending ? (
        <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Loading history…</p>
      ) : traffic.isError || points.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>
          No samples in this range yet — the sampler backfills from here.
        </p>
      ) : (
        <div style={{ height: 224 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ left: 8, right: 8 }}>
              <defs>
                <linearGradient id="swTrafficIn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-pass)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-pass)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="swTrafficOut" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} minTickGap={40} />
              <YAxis
                tickFormatter={(v) => unit(Number(v))}
                tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
                width={64}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 12,
                  fontSize: 13,
                }}
                labelStyle={{ color: 'var(--color-text)', fontWeight: 600, marginBottom: 2 }}
                itemStyle={{ color: 'var(--color-text)' }}
                cursor={{ fill: 'var(--color-muted)', fillOpacity: 0.07 }}
                formatter={(v) => unit(typeof v === 'number' ? v : Number(v))}
              />
              <Area
                type="monotone"
                dataKey="In"
                stroke="var(--color-pass)"
                strokeWidth={2}
                fill="url(#swTrafficIn)"
              />
              {hasOut && (
                <Area
                  type="monotone"
                  dataKey="Out"
                  stroke="var(--color-brand)"
                  strokeWidth={2}
                  fill="url(#swTrafficOut)"
                />
              )}
              <Legend wrapperStyle={{ fontSize: 13, color: 'var(--color-muted)' }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
