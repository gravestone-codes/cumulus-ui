/**
 * Dashboard widgets (roadmap 3H.1): one library for the fleet dashboard,
 * group overview and switch home. Each widget takes the switches in scope
 * and reads live endpoints through shared query keys (lib/vitals), so ten
 * widgets over one switch still cost one read per path. Nothing fabricated:
 * unread values render as "—", unreachable switches are named.
 */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend as ChartLegend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../lib/api.js';
import type { SwitchRow } from '../../lib/api.js';
import { Badge } from '../../components/ui.js';
import {
  Card,
  Legend,
  Meter,
  MiniTable,
  Quiet,
  Stat,
  StatRow,
  StackBar,
  bytes,
  packets,
} from '../../components/cards.js';
import { ActivityList } from '../../components/activity.js';
import { DataTable } from '../../components/DataTable.js';
import { usePorts, useVitals, uptimeText, type PortRow } from '../../lib/vitals.js';

const nameOf = (switches: SwitchRow[], id: string) => switches.find((s) => s.id === id)?.display_name || id;

const TOOLTIP_STYLE = {
  contentStyle: {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    fontSize: 13,
  },
  labelStyle: { color: 'var(--color-text)', fontWeight: 600, marginBottom: 2 },
  itemStyle: { color: 'var(--color-text)' },
  cursor: { fill: 'var(--color-muted)', fillOpacity: 0.07 },
};

function FleetStatsCard({ switches }: { switches: SwitchRow[] }) {
  const n = switches.length;
  const reachable = switches.filter((x) => x.last_check_ok).length;
  const failing = switches.filter((x) => x.last_check_ok === false).length;
  const untrusted = switches.filter((x) => !x.trust_verified).length;
  return (
    <StatRow columns={2}>
      <Stat label="Switches" value={String(n)} sub={`${reachable} reachable`} />
      <Stat
        label="Failing"
        value={String(failing)}
        sub="Last check failed"
        tone={failing > 0 ? 'var(--color-fail)' : undefined}
      />
      <Stat
        label="Untrusted"
        value={String(untrusted)}
        sub="Awaiting TOFU decision"
        tone={untrusted > 0 ? 'var(--color-warn)' : undefined}
      />
    </StatRow>
  );
}

const REACH_HEX: Record<string, string> = {
  Reachable: 'var(--color-pass)',
  Unreachable: 'var(--color-fail)',
  Unknown: 'var(--color-muted)',
};

function ReachabilityCard({ switches }: { switches: SwitchRow[] }) {
  const data = Object.entries({
    Reachable: switches.filter((x) => x.last_check_ok === true).length,
    Unreachable: switches.filter((x) => x.last_check_ok === false).length,
    Unknown: switches.filter((x) => x.last_check_ok !== true && x.last_check_ok !== false).length,
  })
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));
  if (data.length === 0) {
    return <Quiet>No switches yet.</Quiet>;
  }
  return (
    <div style={{ height: 208 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={64} outerRadius={80} paddingAngle={3}>
            {data.map((s) => (
              <Cell key={s.name} fill={REACH_HEX[s.name]} />
            ))}
          </Pie>
          <Tooltip {...TOOLTIP_STYLE} />
          <ChartLegend wrapperStyle={{ fontSize: 13, color: 'var(--color-muted)' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Fleet traffic: every member's switch-wide sampler series summed per tick
 * (bytes → bits). Real endpoints only — no fabricated series. Empty when the
 * sampler has nothing yet.
 */
function TrafficCard({ switches }: { switches: SwitchRow[] }) {
  const traffic = useQuery({
    queryKey: [
      'fleet-traffic',
      switches
        .map((s) => s.id)
        .sort()
        .join(','),
    ],
    queryFn: async () => {
      const per = await Promise.all(
        switches.map((s) => api.switchTraffic(s.id, { range: '24h', metric: 'bytes' }).catch(() => null)),
      );
      const byTick = new Map<string, { t: string; in: number; out: number }>();
      for (const r of per) {
        for (const p of r?.points ?? []) {
          const cur = byTick.get(p.t) ?? { t: p.t, in: 0, out: 0 };
          cur.in += p.in;
          cur.out += p.out;
          byTick.set(p.t, cur);
        }
      }
      return [...byTick.values()].sort((a, b) => (a.t < b.t ? -1 : 1));
    },
    enabled: switches.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  if (switches.length === 0) {
    return <Quiet>No switches yet.</Quiet>;
  }
  if (traffic.isPending) {
    return <Quiet>Loading…</Quiet>;
  }
  const points = (traffic.data ?? []).map((p) => ({
    label: new Date(p.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    In: p.in * 8,
    Out: p.out * 8,
  }));
  if (points.length === 0) {
    return (
      <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>
        No samples in this range yet — the sampler backfills from here.
      </p>
    );
  }
  const bps = (v: number) => `${packets(v)}bps`;
  return (
    <div style={{ height: 256 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ left: 8, right: 8 }}>
          <defs>
            <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-pass)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-pass)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} minTickGap={40} />
          <YAxis
            tickFormatter={(v) => bps(Number(v))}
            tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
            width={64}
          />
          <Tooltip {...TOOLTIP_STYLE} formatter={(v) => bps(typeof v === 'number' ? v : Number(v))} />
          <Area
            type="monotone"
            dataKey="In"
            name="In"
            stroke="var(--color-pass)"
            strokeWidth={2}
            fill="url(#trafficFill)"
          />
          <Area
            type="monotone"
            dataKey="Out"
            name="Out"
            stroke="var(--color-brand)"
            strokeWidth={2}
            fill="transparent"
          />
          <ChartLegend wrapperStyle={{ fontSize: 13, color: 'var(--color-muted)' }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Interfaces by device: real per-switch interface counts via the `small`
 * view (keys only — no per-interface payload). Bars sort descending.
 */
function InterfacesByDeviceCard({ switches }: { switches: SwitchRow[] }) {
  const counts = useQuery({
    queryKey: [
      'fleet-iface-counts',
      switches
        .map((s) => s.id)
        .sort()
        .join(','),
    ],
    queryFn: async () => {
      const per = await Promise.all(
        switches.map(async (s) => {
          try {
            const res = await api.query<Record<string, unknown>>(s.id, '/interface', { view: 'small' });
            return { name: s.display_name || s.id, interfaces: Object.keys(res.data).length };
          } catch {
            return { name: s.display_name || s.id, interfaces: 0 };
          }
        }),
      );
      return per.sort((a, b) => b.interfaces - a.interfaces).slice(0, 12);
    },
    enabled: switches.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  if (switches.length === 0) {
    return <Quiet>No switches yet.</Quiet>;
  }
  if (counts.isPending) {
    return <Quiet>Loading…</Quiet>;
  }
  const data = counts.data ?? [];
  if (data.every((d) => d.interfaces === 0)) {
    return (
      <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>
        No interface data — check switch reachability.
      </p>
    );
  }
  return (
    <div style={{ height: 256 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
          <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: 'var(--color-muted)' }}
            width={90}
          />
          <Tooltip {...TOOLTIP_STYLE} />
          <Bar
            dataKey="interfaces"
            name="Interfaces"
            fill="var(--color-pass)"
            radius={[0, 4, 4, 0]}
            maxBarSize={14}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
/**
 * Audit tail for the scope: fleet-wide on the dashboard, merged per member
 * for a group, one switch on its home (the fleet passes `fleet`).
 */
function RecentActivityCard({ switches, fleet }: { switches: SwitchRow[]; fleet?: boolean }) {
  const navigate = useNavigate();
  const ids = switches.map((s) => s.id).sort();
  const activity = useQuery({
    queryKey: ['audit-recent', fleet ? '*' : ids.join(',')],
    queryFn: async () => {
      if (fleet) return api.audit(8);
      const per = await Promise.all(ids.map((id) => api.audit(8, id).catch(() => [])));
      return per
        .flat()
        .sort((a, b) => (a.ts < b.ts ? 1 : -1))
        .slice(0, 8);
    },
    retry: false,
  });
  if (activity.isError) return null;
  if (activity.isPending) return <Quiet>Loading…</Quiet>;
  return (
    <ActivityList
      rows={activity.data}
      onOpen={(row) => row.switch_id && navigate(`/switches/${row.switch_id}/audit`)}
    />
  );
}

const PORT_COLORS = {
  up: 'var(--color-pass)',
  down: 'var(--color-fail)',
  'admin-down': 'var(--color-muted)',
  unknown: 'var(--color-border)',
} as const;

/** System health per switch: NVUE's own verdict plus the services it flags. */
function HealthCard({ switches }: { switches: SwitchRow[] }) {
  const navigate = useNavigate();
  const ids = switches.map((s) => s.id);
  const v = useVitals(ids);
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (v.loading) return <Quiet>Loading…</Quiet>;
  if (switches.length === 1) {
    const h = v.byId[ids[0] ?? '']?.health;
    if (!h) return <Quiet>Health not reported.</Quiet>;
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <span>
          <Badge tone={h.ok ? 'pass' : 'fail'}>{h.status}</Badge>
        </span>
        <MiniTable
          cols={[
            { label: 'Check', cell: (i) => i.name },
            {
              label: 'State',
              cell: (i) => <Badge tone={i.ok ? 'pass' : 'warn'}>{i.text.split(' since ')[0]}</Badge>,
            },
          ]}
          rows={h.issues}
          rowKey={(i) => i.name}
        />
      </div>
    );
  }
  const ok = ids.filter((id) => v.byId[id]?.health?.ok).length;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Legend
        items={[
          { label: 'OK', value: ok, color: 'var(--color-pass)' },
          { label: 'Not OK', value: ids.length - ok - v.failed.length, color: 'var(--color-fail)' },
          { label: 'Unreachable', value: v.failed.length, color: 'var(--color-muted)' },
        ]}
      />
      <MiniTable
        cols={[
          { label: 'Switch', cell: (id: string) => nameOf(switches, id) },
          {
            label: 'Status',
            cell: (id) => {
              const h = v.byId[id]?.health;
              if (!h) return <Badge>{v.failed.includes(id) ? 'unreachable' : 'unknown'}</Badge>;
              return <Badge tone={h.ok ? 'pass' : 'fail'}>{h.status}</Badge>;
            },
          },
          {
            label: 'Flagged',
            cell: (id) =>
              v.byId[id]?.health?.issues
                .filter((i) => !i.ok)
                .map((i) => i.name)
                .join(', ') || '—',
          },
        ]}
        rows={ids}
        rowKey={(id) => id}
        onRow={(id) => navigate(`/switches/${encodeURIComponent(id)}`)}
      />
    </div>
  );
}

/** CPU and memory utilization per switch. */
function ResourcesCard({ switches }: { switches: SwitchRow[] }) {
  const ids = switches.map((s) => s.id);
  const v = useVitals(ids);
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (v.loading) return <Quiet>Loading…</Quiet>;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {ids.map((id) => {
        const x = v.byId[id];
        return (
          <div key={id} style={{ display: 'grid', gap: 6 }}>
            {ids.length > 1 && (
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {nameOf(switches, id)}
                {v.failed.includes(id) && <span style={{ color: 'var(--color-muted)' }}> · unreachable</span>}
              </span>
            )}
            <Meter label="CPU" value={x?.cpu} />
            <Meter label="Mem" value={x?.memory} />
            {ids.length === 1 && x?.memoryText && (
              <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{x.memoryText}</span>
            )}
          </div>
        );
      })}
      {children}
    </div>
  );
}

/** Member roster for a group: reachability, health, release, uptime and load per switch. */
export function MemberTable({ switches, groupId }: { switches: SwitchRow[]; groupId: string }) {
  const navigate = useNavigate();
  const v = useVitals(switches.map((s) => s.id));
  type Row = SwitchRow & { __health: string };
  const rows: Row[] = switches.map((s) => ({
    ...s,
    __health: v.byId[s.id]?.health?.status ?? (v.failed.includes(s.id) ? 'unreachable' : ''),
  }));
  const pct = (n: number | undefined) => (n === undefined ? '—' : `${Math.round(n)}%`);
  return (
    <DataTable<Row>
      storageKey={`cumulus.group-members.${groupId}.v1`}
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={(r) => navigate(`/switches/${encodeURIComponent(r.id)}`)}
      cols={[
        { key: 'name', label: 'Switch', always: true, value: (r) => r.display_name || r.id },
        {
          key: 'reach',
          label: 'Reachable',
          value: (r) => (r.last_check_ok === true ? 'yes' : r.last_check_ok === false ? 'no' : 'unknown'),
          render: (r) => (
            <Badge tone={r.last_check_ok === true ? 'pass' : r.last_check_ok === false ? 'fail' : 'muted'}>
              {r.last_check_ok === true ? 'yes' : r.last_check_ok === false ? 'no' : 'unknown'}
            </Badge>
          ),
        },
        {
          key: 'health',
          label: 'Health',
          value: (r) => r.__health || '—',
          render: (r) =>
            r.__health ? (
              <Badge
                tone={
                  r.__health.toLowerCase() === 'ok' ? 'pass' : r.__health === 'unreachable' ? 'muted' : 'fail'
                }
              >
                {r.__health}
              </Badge>
            ) : (
              '—'
            ),
        },
        { key: 'release', label: 'Release', value: (r) => v.byId[r.id]?.version ?? '—' },
        { key: 'uptime', label: 'Uptime', value: (r) => uptimeText(v.byId[r.id]?.uptime) },
        { key: 'cpu', label: 'CPU', value: (r) => pct(v.byId[r.id]?.cpu) },
        { key: 'mem', label: 'Memory', value: (r) => pct(v.byId[r.id]?.memory) },
        { key: 'trust', label: 'Trust', value: (r) => (r.trust_verified ? 'verified' : 'pending') },
      ]}
    />
  );
}

/** Port states (up / down / admin down) per switch and in total. */
function PortStatusCard({ switches }: { switches: SwitchRow[] }) {
  const ids = switches.map((s) => s.id);
  const p = usePorts(ids);
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (p.loading) return <Quiet>Loading…</Quiet>;
  const count = (rows: PortRow[]) =>
    (Object.keys(PORT_COLORS) as Array<keyof typeof PORT_COLORS>).map((k) => ({
      label: k === 'admin-down' ? 'Admin down' : k[0]!.toUpperCase() + k.slice(1),
      value: rows.filter((r) => r.state === k).length,
      color: PORT_COLORS[k],
    }));
  const total = count(p.rows);
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <StatRow columns={3}>
        <Stat label="Ports" value={String(p.rows.length)} />
        <Stat label="Up" value={String(total[0]?.value ?? 0)} tone="var(--color-pass)" />
        <Stat
          label="Down"
          value={String(total[1]?.value ?? 0)}
          tone={(total[1]?.value ?? 0) > 0 ? 'var(--color-fail)' : undefined}
        />
      </StatRow>
      {ids.length > 1 ? (
        ids.map((id) => (
          <div key={id} style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {nameOf(switches, id)}
              {p.failed.includes(id) && <span style={{ color: 'var(--color-muted)' }}> · unreachable</span>}
            </span>
            <StackBar parts={count(p.rows.filter((r) => r.sw === id))} />
          </div>
        ))
      ) : (
        <StackBar parts={total} />
      )}
      <Legend items={total} />
    </div>
  );
}

/** Ports with errors or drops, worst first (cumulative since last clear). */
function InterfaceErrorsCard({ switches }: { switches: SwitchRow[] }) {
  const navigate = useNavigate();
  const p = usePorts(switches.map((s) => s.id));
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (p.loading) return <Quiet>Loading…</Quiet>;
  const bad = p.rows
    .filter((r) => r.errors + r.drops > 0)
    .sort((a, b) => b.errors + b.drops - (a.errors + a.drops))
    .slice(0, 8);
  if (bad.length === 0) {
    return (
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
        <Badge tone="pass">clean</Badge>
        <span style={{ color: 'var(--color-muted)' }}>No errors or drops on {p.rows.length} ports.</span>
      </span>
    );
  }
  return (
    <MiniTable
      cols={[
        ...(switches.length > 1 ? [{ label: 'Switch', cell: (r: PortRow) => nameOf(switches, r.sw) }] : []),
        { label: 'Port', cell: (r: PortRow) => r.name },
        { label: 'Errors', align: 'right', cell: (r: PortRow) => packets(r.errors) },
        { label: 'Drops', align: 'right', cell: (r: PortRow) => packets(r.drops) },
      ]}
      rows={bad}
      rowKey={(r) => `${r.sw}/${r.name}`}
      onRow={(r) =>
        navigate(`/switches/${encodeURIComponent(r.sw)}/interfaces/${encodeURIComponent(r.name)}`)
      }
    />
  );
}

/** Busiest ports by bytes moved (cumulative counters). */
function TopTalkersCard({ switches }: { switches: SwitchRow[] }) {
  const navigate = useNavigate();
  const p = usePorts(switches.map((s) => s.id));
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (p.loading) return <Quiet>Loading…</Quiet>;
  const top = [...p.rows]
    .filter((r) => r.inBytes + r.outBytes > 0)
    .sort((a, b) => b.inBytes + b.outBytes - (a.inBytes + a.outBytes))
    .slice(0, 8);
  if (top.length === 0) return <Quiet>No traffic counted yet.</Quiet>;
  return (
    <MiniTable
      cols={[
        ...(switches.length > 1 ? [{ label: 'Switch', cell: (r: PortRow) => nameOf(switches, r.sw) }] : []),
        { label: 'Port', cell: (r: PortRow) => r.name },
        { label: 'In', align: 'right', cell: (r: PortRow) => bytes(r.inBytes) },
        { label: 'Out', align: 'right', cell: (r: PortRow) => bytes(r.outBytes) },
      ]}
      rows={top}
      rowKey={(r) => `${r.sw}/${r.name}`}
      onRow={(r) =>
        navigate(`/switches/${encodeURIComponent(r.sw)}/interfaces/${encodeURIComponent(r.name)}`)
      }
    />
  );
}

/** Fans, PSUs and temperature sensors: counts, hottest reading, anything not OK. */
function EnvironmentCard({ switches }: { switches: SwitchRow[] }) {
  const ids = switches.map((s) => s.id);
  const v = useVitals(ids);
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (v.loading) return <Quiet>Loading…</Quiet>;
  const all = ids.flatMap((id) => (v.byId[id]?.sensors ?? []).map((s) => ({ ...s, sw: id })));
  if (all.length === 0) return <Quiet>No environment data reported.</Quiet>;
  const of = (type: string) => all.filter((s) => s.type === type);
  const ratio = (list: typeof all) => `${list.filter((s) => s.ok).length}/${list.length}`;
  const hottest = all
    .filter((s) => s.current !== undefined)
    .sort((a, b) => (b.current ?? 0) - (a.current ?? 0))[0];
  const bad = all.filter((s) => !s.ok);
  const hot = hottest?.current !== undefined && hottest.max !== undefined && hottest.current >= hottest.max;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <StatRow columns={3}>
        <Stat
          label="Fans OK"
          value={ratio(of('fan'))}
          tone={of('fan').every((s) => s.ok) ? undefined : 'var(--color-fail)'}
        />
        <Stat
          label="PSUs OK"
          value={ratio(of('psu'))}
          tone={of('psu').every((s) => s.ok) ? undefined : 'var(--color-fail)'}
        />
        <Stat
          label="Hottest"
          value={hottest?.current !== undefined ? `${hottest.current}°` : '—'}
          sub={
            hottest ? (ids.length > 1 ? `${nameOf(switches, hottest.sw)} · ` : '') + hottest.name : undefined
          }
          tone={hot ? 'var(--color-fail)' : undefined}
        />
      </StatRow>
      {bad.length > 0 ? (
        <MiniTable
          cols={[
            ...(ids.length > 1
              ? [{ label: 'Switch', cell: (s: (typeof all)[number]) => nameOf(switches, s.sw) }]
              : []),
            { label: 'Sensor', cell: (s: (typeof all)[number]) => s.name },
            {
              label: 'State',
              cell: (s: (typeof all)[number]) => <Badge tone="fail">{s.state || 'unknown'}</Badge>,
            },
          ]}
          rows={bad}
          rowKey={(s) => `${s.sw}/${s.name}`}
        />
      ) : (
        <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>All {all.length} sensors report OK.</span>
      )}
    </div>
  );
}

/** Software release, hostname and uptime per switch. */
function SoftwareCard({ switches }: { switches: SwitchRow[] }) {
  const navigate = useNavigate();
  const ids = switches.map((s) => s.id);
  const v = useVitals(ids);
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (v.loading) return <Quiet>Loading…</Quiet>;
  if (ids.length === 1) {
    const x = v.byId[ids[0] ?? ''];
    return (
      <StatRow columns={3}>
        <Stat label="Release" value={x?.version ?? '—'} />
        <Stat label="Uptime" value={uptimeText(x?.uptime)} />
        <Stat label="Hostname" value={x?.hostname ?? '—'} />
      </StatRow>
    );
  }
  const versions = [...new Set(ids.map((id) => v.byId[id]?.version).filter((x): x is string => !!x))];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {versions.length > 1 && (
        <span style={{ fontSize: 13 }}>
          <Badge tone="warn">mixed</Badge>{' '}
          <span style={{ color: 'var(--color-muted)' }}>{versions.length} releases in scope</span>
        </span>
      )}
      <MiniTable
        cols={[
          { label: 'Switch', cell: (id: string) => nameOf(switches, id) },
          { label: 'Release', cell: (id) => v.byId[id]?.version ?? '—' },
          { label: 'Uptime', align: 'right', cell: (id) => uptimeText(v.byId[id]?.uptime) },
        ]}
        rows={ids}
        rowKey={(id) => id}
        onRow={(id) => navigate(`/switches/${encodeURIComponent(id)}`)}
      />
    </div>
  );
}

/**
 * Widget registry, mirrored by the server WIDGET_CATALOG. Widgets are
 * components (never invoked as functions): their hooks must run
 * unconditionally, independent of which widgets are active (React #310).
 */
/** `fleet` marks the whole-inventory scope (fleet dashboard) as opposed to a group or one switch. */
export type WidgetComponent = (props: { switches: SwitchRow[]; fleet?: boolean }) => React.ReactNode;
export const WIDGETS: Record<
  string,
  { title: string; blurb: string; info?: string; wide?: boolean; Component: WidgetComponent }
> = {
  'fleet-stats': {
    title: 'Fleet at a glance',
    blurb: 'Switch, reachability and trust counts.',
    Component: FleetStatsCard,
  },
  health: {
    title: 'System health',
    blurb: "Each switch's own health verdict and the checks it flags.",
    info: 'NVUE system health: overall status plus each monitored service or component. Anything not active or OK is flagged.',
    Component: HealthCard,
  },
  reachability: {
    title: 'Switches by reachability',
    blurb: 'Reachable / unreachable / unknown pie.',
    Component: ReachabilityCard,
  },
  resources: {
    title: 'CPU & memory',
    blurb: 'Utilization per switch.',
    info: 'Current CPU and physical memory utilization. Amber past 80%, red past 90%.',
    Component: ResourcesCard,
  },
  'port-status': {
    title: 'Port status',
    blurb: 'Ports up, down and admin down.',
    info: 'Every port except loopbacks and VRF devices. Admin down = shut on purpose; down = enabled but no link.',
    Component: PortStatusCard,
  },
  traffic: {
    title: 'Bits over time (24h)',
    blurb: 'Summed switch-wide sampler series.',
    wide: true,
    Component: TrafficCard,
  },
  'interface-errors': {
    title: 'Ports with errors',
    blurb: 'Worst ports by errors and drops.',
    info: 'In + out errors and drops per port, counted since the counters were last cleared. Click a row to open the port.',
    Component: InterfaceErrorsCard,
  },
  'top-talkers': {
    title: 'Top talkers',
    blurb: 'Busiest ports by bytes.',
    info: 'Bytes received and sent per port since the counters were last cleared.',
    Component: TopTalkersCard,
  },
  environment: {
    title: 'Environment',
    blurb: 'Fans, PSUs and temperatures.',
    info: 'Platform sensors: fans and power supplies OK vs total, the hottest temperature reading, and any sensor not OK.',
    Component: EnvironmentCard,
  },
  software: { title: 'Software & uptime', blurb: 'Release and uptime per switch.', Component: SoftwareCard },
  'interfaces-by-device': {
    title: 'Interfaces by device',
    blurb: 'Live interface counts per switch.',
    Component: InterfacesByDeviceCard,
  },
  'recent-activity': { title: 'Recent activity', blurb: 'Audit trail tail.', Component: RecentActivityCard },
};

/** Widget cards in the responsive dashboard grid; `onRemove` turns on customize mode. */
export function WidgetGrid({
  ids,
  switches,
  fleet,
  onRemove,
  children,
}: {
  ids: string[];
  switches: SwitchRow[];
  fleet?: boolean;
  onRemove?: (id: string) => void;
  /** Scope-specific cards placed after the widgets (wrap in `.wide` to span). */
  children?: React.ReactNode;
}) {
  return (
    <div className="widget-grid">
      {ids.map((id) => {
        const w = WIDGETS[id];
        if (!w) return null;
        const { Component } = w;
        return (
          <div key={id} className={w.wide ? 'wide' : undefined} style={{ minWidth: 0, display: 'grid' }}>
            <Card title={w.title} info={w.info} onRemove={onRemove ? () => onRemove(id) : undefined}>
              <Component switches={switches} fleet={fleet} />
            </Card>
          </div>
        );
      })}
      {children}
    </div>
  );
}

/** Member roster for a group: reachability, health, release, uptime and load per switch. */
export function MemberTable({ switches, groupId }: { switches: SwitchRow[]; groupId: string }) {
  const navigate = useNavigate();
  const v = useVitals(switches.map((s) => s.id));
  type Row = SwitchRow & { __health: string };
  const rows: Row[] = switches.map((s) => ({
    ...s,
    __health: v.byId[s.id]?.health?.status ?? (v.failed.includes(s.id) ? 'unreachable' : ''),
  }));
  const pct = (n: number | undefined) => (n === undefined ? '—' : `${Math.round(n)}%`);
  return (
    <DataTable<Row>
      storageKey={`cumulus.group-members.${groupId}.v1`}
      rows={rows}
      rowKey={(r) => r.id}
      onRowClick={(r) => navigate(`/switches/${encodeURIComponent(r.id)}`)}
      cols={[
        { key: 'name', label: 'Switch', always: true, value: (r) => r.display_name || r.id },
        {
          key: 'reach',
          label: 'Reachable',
          value: (r) => (r.last_check_ok === true ? 'yes' : r.last_check_ok === false ? 'no' : 'unknown'),
          render: (r) => (
            <Badge tone={r.last_check_ok === true ? 'pass' : r.last_check_ok === false ? 'fail' : 'muted'}>
              {r.last_check_ok === true ? 'yes' : r.last_check_ok === false ? 'no' : 'unknown'}
            </Badge>
          ),
        },
        {
          key: 'health',
          label: 'Health',
          value: (r) => r.__health || '—',
          render: (r) =>
            r.__health ? (
              <Badge
                tone={
                  r.__health.toLowerCase() === 'ok' ? 'pass' : r.__health === 'unreachable' ? 'muted' : 'fail'
                }
              >
                {r.__health}
              </Badge>
            ) : (
              '—'
            ),
        },
        { key: 'release', label: 'Release', value: (r) => v.byId[r.id]?.version ?? '—' },
        { key: 'uptime', label: 'Uptime', value: (r) => uptimeText(v.byId[r.id]?.uptime) },
        { key: 'cpu', label: 'CPU', value: (r) => pct(v.byId[r.id]?.cpu) },
        { key: 'mem', label: 'Memory', value: (r) => pct(v.byId[r.id]?.memory) },
        { key: 'trust', label: 'Trust', value: (r) => (r.trust_verified ? 'verified' : 'pending') },
      ]}
    />
  );
}
