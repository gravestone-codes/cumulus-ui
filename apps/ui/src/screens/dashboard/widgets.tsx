/**
 * Dashboard widgets (roadmap 3H.1): one library for the fleet dashboard,
 * group overview and switch home. Each widget takes the switches in scope
 * and reads live endpoints through shared query keys (lib/vitals), so ten
 * widgets over one switch still cost one read per path. Nothing fabricated:
 * unread values render as "—", unreachable switches are named.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries, useQuery } from '@tanstack/react-query';
import {
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
  AllClear,
  Card,
  Facts,
  Legend,
  Meter,
  MiniTable,
  Quiet,
  Stat,
  StatRow,
  StackBar,
  SubHead,
  bytes,
  packets,
} from '../../components/cards.js';
import { ActivityList } from '../../components/activity.js';
import { DataTable } from '../../components/DataTable.js';
import { usePorts, useVitals, uptimeText, type PortRow, type Sensor } from '../../lib/vitals.js';
import { timeAgo } from '../../lib/format.js';
import { parseBgp, parseRoutes, protocolCounts, type BgpRow } from '../../lib/troubleshoot.js';
import { diffCommands, toCommands } from '../../lib/nvconfig.js';
import { TrafficPanel } from '../iface/Traffic.js';
import { moveWidget } from '../../lib/layout.js';

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

const pctText = (n: number | undefined) => (n === undefined ? '—' : `${Number(n.toFixed(1))}%`);
const bytesText = (n: number | undefined) => (n === undefined ? '—' : bytes(n));

/**
 * One block per switch in scope, the same block a switch home shows: one
 * switch reads "Utilization", several are headed by name (unreachable said).
 */
function PerSwitch({
  switches,
  failed,
  children,
}: {
  switches: SwitchRow[];
  failed: string[];
  children: (id: string, heading: string) => React.ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gap: 22 }}>
      {switches.map((s) => (
        <section key={s.id} style={{ display: 'grid', gap: 10 }}>
          {children(
            s.id,
            switches.length === 1
              ? 'Utilization'
              : `${nameOf(switches, s.id)}${failed.includes(s.id) ? ' · unreachable' : ''}`,
          )}
        </section>
      ))}
    </div>
  );
}

/** CPU per switch: reading, bar, then the model, cores, used and free behind it. */
function CpuCard({ switches }: WidgetProps) {
  const v = useVitals(switches.map((s) => s.id));
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (v.loading) return <Quiet>Loading…</Quiet>;
  return (
    <PerSwitch switches={switches} failed={v.failed}>
      {(id, heading) => {
        const x = v.byId[id];
        return (
          <>
            <SubHead title={heading} value={pctText(x?.cpu)} />
            <Meter label={`${heading} CPU utilization`} value={x?.cpu} bare />
            <Facts
              items={[
                {
                  label: 'Model',
                  // Trademark marks cost width and say nothing; the full string stays in the tooltip.
                  value: x?.cpuModel?.replace(/\((R|TM)\)/gi, '').replace(/\s+/g, ' ') ?? '—',
                  title: x?.cpuModel,
                },
                { label: 'Cores', value: x?.cpuCores === undefined ? '—' : String(x.cpuCores) },
                { label: 'Used', value: pctText(x?.cpu) },
                { label: 'Free', value: pctText(x?.cpu === undefined ? undefined : 100 - x.cpu) },
              ]}
            />
          </>
        );
      }}
    </PerSwitch>
  );
}

/** Memory per switch: reading, bar, then total, used, buffers & cache, free and swap. */
function MemoryCard({ switches }: WidgetProps) {
  const v = useVitals(switches.map((s) => s.id));
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (v.loading) return <Quiet>Loading…</Quiet>;
  return (
    <PerSwitch switches={switches} failed={v.failed}>
      {(id, heading) => {
        const x = v.byId[id];
        const swap = x?.swap;
        return (
          <>
            <SubHead title={heading} value={pctText(x?.memory)} />
            <Meter label={`${heading} memory utilization`} value={x?.memory} bare />
            <Facts
              items={[
                { label: 'Total', value: bytesText(x?.physical.total) },
                { label: 'Used', value: bytesText(x?.physical.used) },
                { label: 'Buffers & cache', value: bytesText(x?.physical.cache) },
                { label: 'Free', value: bytesText(x?.physical.free) },
                {
                  label: 'Swap',
                  value:
                    swap?.total === undefined
                      ? '—'
                      : swap.total === 0
                        ? 'none'
                        : `${bytesText(swap.used)} of ${bytesText(swap.total)}`,
                },
              ]}
            />
          </>
        );
      }}
    </PerSwitch>
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
      <StatRow columns={2}>
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
    return <AllClear>No errors or drops on {p.rows.length} ports.</AllClear>;
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
      <StatRow columns={2}>
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
      <Facts
        items={[
          { label: 'Release', value: x?.version ?? '—' },
          { label: 'Uptime', value: uptimeText(x?.uptime) },
          { label: 'Hostname', value: x?.hostname ?? '—' },
          { label: 'Build', value: x?.build ?? '—' },
          { label: 'Kernel', value: x?.kernel ?? '—' },
          { label: 'Base OS', value: x?.baseOs ?? '—' },
        ]}
      />
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

/** Every switch in scope's state from one per-switch read, keyed so other screens share the cache. */
function useEach<T>(ids: string[], key: (id: string) => unknown[], read: (id: string) => Promise<T>) {
  const qs = useQueries({
    queries: ids.map((id) => ({
      queryKey: key(id),
      queryFn: () => read(id),
      staleTime: 30_000,
      retry: false,
    })),
  });
  const byId: Record<string, T> = {};
  const failed: string[] = [];
  qs.forEach((q, i) => {
    const id = ids[i] ?? '';
    if (q.data !== undefined) byId[id] = q.data;
    else if (q.isError) failed.push(id);
  });
  return { byId, failed, loading: qs.some((q) => q.isPending) };
}

/** Names of members that could not be read, so a total never hides them. */
function Unread({ switches, failed }: { switches: SwitchRow[]; failed: string[] }) {
  if (failed.length === 0) return null;
  return (
    <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
      Could not read {failed.map((id) => nameOf(switches, id)).join(', ')}.
    </span>
  );
}

/** One switch's identity and how the platform reaches it. */
function ConnectionCard({ switches }: WidgetProps) {
  const row = switches[0];
  if (!row) return <Quiet>No switch.</Quiet>;
  let host = row.base_url;
  try {
    host = new URL(row.base_url).host;
  } catch {
    /* keep the raw URL */
  }
  return (
    <Facts
      items={[
        {
          label: 'Trust',
          value: row.trust_verified ? 'Verified' : 'Pending',
          tone: row.trust_verified ? 'var(--color-pass)' : 'var(--color-warn)',
        },
        {
          label: 'Reachable',
          value: row.last_check_ok === true ? 'Yes' : row.last_check_ok === false ? 'No' : 'Unknown',
          tone:
            row.last_check_ok === true
              ? 'var(--color-pass)'
              : row.last_check_ok === false
                ? 'var(--color-fail)'
                : undefined,
        },
        { label: 'Last seen', value: timeAgo(row.last_seen_at) },
        { label: 'Last checked', value: timeAgo(row.last_check_at) },
        { label: 'Address', value: host, title: row.base_url },
        { label: 'Groups', value: row.groups.length > 0 ? row.groups.join(', ') : 'none' },
      ]}
    />
  );
}

/** Whole-scope traffic with live, ranges, custom periods and compare (its own card). */
function TrafficWidget({ switches, title, info, onRemove }: WidgetProps) {
  if (switches.length === 0)
    return (
      <Card title={title}>
        <Quiet>No switches yet.</Quiet>
      </Card>
    );
  return (
    <TrafficPanel
      embedded
      switchIds={switches.map((s) => s.id)}
      initialRange="24h"
      title={title}
      info={info}
      onRemove={onRemove}
    />
  );
}

/** Group roster as a widget. */
function MembersCard({ switches, groupId }: WidgetProps) {
  if (switches.length === 0) return <Quiet>No members yet.</Quiet>;
  return <MemberTable switches={switches} groupId={groupId ?? 'scope'} />;
}

/** Hottest temperature sensors in scope against their max and critical marks. */
function TemperaturesCard({ switches }: WidgetProps) {
  const ids = switches.map((s) => s.id);
  const v = useVitals(ids);
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (v.loading) return <Quiet>Loading…</Quiet>;
  type Row = Sensor & { sw: string };
  const rows: Row[] = ids
    .flatMap((id) => (v.byId[id]?.sensors ?? []).map((x) => ({ ...x, sw: id })))
    .filter((x) => x.current !== undefined)
    .sort((a, b) => (b.current ?? 0) - (a.current ?? 0))
    .slice(0, 8);
  if (rows.length === 0) return <Quiet>No temperature sensors reported.</Quiet>;
  const tone = (x: Row) =>
    x.crit !== undefined && (x.current ?? 0) >= x.crit
      ? 'fail'
      : x.max !== undefined && (x.current ?? 0) >= x.max
        ? 'warn'
        : 'pass';
  const deg = (n: number | undefined) => (n === undefined ? '—' : `${Math.round(n)}°`);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <MiniTable
        cols={[
          { label: 'Sensor', cell: (x: Row) => x.name },
          ...(ids.length > 1 ? [{ label: 'Switch', cell: (x: Row) => nameOf(switches, x.sw) }] : []),
          {
            label: 'Now',
            align: 'right' as const,
            cell: (x: Row) => <Badge tone={tone(x)}>{deg(x.current)}</Badge>,
          },
          { label: 'Max', align: 'right' as const, cell: (x: Row) => deg(x.max) },
          { label: 'Crit', align: 'right' as const, cell: (x: Row) => deg(x.crit) },
        ]}
        rows={rows}
        rowKey={(x) => `${x.sw}/${x.name}`}
      />
      <Unread switches={switches} failed={v.failed} />
    </div>
  );
}

/** Ports whose link went up and down, most flaps first (since counters were cleared). */
function FlappingPortsCard({ switches }: WidgetProps) {
  const navigate = useNavigate();
  const p = usePorts(switches.map((s) => s.id));
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (p.loading) return <Quiet>Loading…</Quiet>;
  const rows = p.rows
    .filter((r) => r.flaps > 0)
    .sort((a, b) => b.flaps - a.flaps)
    .slice(0, 8);
  if (rows.length === 0) {
    return <AllClear>No link flaps on {p.rows.length} ports.</AllClear>;
  }
  return (
    <MiniTable
      cols={[
        { label: 'Port', cell: (r: PortRow) => r.name },
        ...(switches.length > 1 ? [{ label: 'Switch', cell: (r: PortRow) => nameOf(switches, r.sw) }] : []),
        { label: 'Flaps', align: 'right' as const, cell: (r: PortRow) => r.flaps.toLocaleString() },
        {
          label: 'Now',
          align: 'right' as const,
          cell: (r: PortRow) => (
            <Badge tone={r.state === 'up' ? 'pass' : r.state === 'down' ? 'fail' : 'muted'}>
              {r.state === 'admin-down' ? 'admin down' : r.state}
            </Badge>
          ),
        },
      ]}
      rows={rows}
      rowKey={(r) => `${r.sw}/${r.name}`}
      onRow={(r) =>
        navigate(`/switches/${encodeURIComponent(r.sw)}/interfaces/${encodeURIComponent(r.name)}`)
      }
    />
  );
}

/** Enabled ports without link (cable, optic or far end), separate from ports shut on purpose. */
function DownPortsCard({ switches }: WidgetProps) {
  const navigate = useNavigate();
  const p = usePorts(switches.map((s) => s.id));
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (p.loading) return <Quiet>Loading…</Quiet>;
  const down = p.rows.filter((r) => r.state === 'down');
  const admin = p.rows.filter((r) => r.state === 'admin-down').length;
  if (down.length === 0) {
    return <AllClear>Every enabled port has link{admin > 0 ? ` · ${admin} shut on purpose` : ''}.</AllClear>;
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>
        {down.length} enabled without link · {admin} shut on purpose
      </span>
      {
        <MiniTable
          cols={[
            { label: 'Port', cell: (r: PortRow) => r.name },
            ...(switches.length > 1
              ? [{ label: 'Switch', cell: (r: PortRow) => nameOf(switches, r.sw) }]
              : []),
            { label: 'Type', cell: (r: PortRow) => r.type || '—' },
            { label: 'Flaps', align: 'right' as const, cell: (r: PortRow) => String(r.flaps) },
          ]}
          rows={down.slice(0, 8)}
          rowKey={(r) => `${r.sw}/${r.name}`}
          onRow={(r) =>
            navigate(`/switches/${encodeURIComponent(r.sw)}/interfaces/${encodeURIComponent(r.name)}`)
          }
        />
      }
    </div>
  );
}

/** BGP sessions across every VRF of every switch in scope; anything not established is listed. */
function BgpSessionsCard({ switches }: WidgetProps) {
  const navigate = useNavigate();
  const ids = switches.map((s) => s.id);
  // Same key and read as Troubleshoot → BGP, so either screen warms the other.
  const each = useEach(
    ids,
    (id) => ['collect', id, 'bgp'],
    (id) => api.collect<unknown>(id, '/vrf', '/vrf/{key}/router/bgp/neighbor', { rev: 'operational' }),
  );
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (each.loading) return <Quiet>Loading…</Quiet>;
  type Row = BgpRow & { sw: string };
  const rows: Row[] = ids.flatMap((id) =>
    parseBgp((each.byId[id]?.data ?? {}) as Record<string, unknown>).map((r) => ({ ...r, sw: id })),
  );
  const up = rows.filter((r) => r.established).length;
  const down = rows.filter((r) => !r.established);
  if (rows.length === 0) {
    return (
      <div style={{ display: 'grid', gap: 8 }}>
        <Quiet>BGP is not running in scope.</Quiet>
        <Unread switches={switches} failed={each.failed} />
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <StatRow columns={2}>
        <Stat label="Peers" value={String(rows.length)} />
        <Stat label="Established" value={String(up)} tone={up > 0 ? 'var(--color-pass)' : undefined} />
        <Stat
          label="Down"
          value={String(down.length)}
          tone={down.length > 0 ? 'var(--color-fail)' : undefined}
        />
      </StatRow>
      {down.length > 0 && (
        <MiniTable
          cols={[
            { label: 'Peer', cell: (r: Row) => r.peer },
            ...(ids.length > 1 ? [{ label: 'Switch', cell: (r: Row) => nameOf(switches, r.sw) }] : []),
            { label: 'VRF', cell: (r: Row) => r.vrf },
            {
              label: 'State',
              align: 'right' as const,
              cell: (r: Row) => <Badge tone="fail">{r.state}</Badge>,
            },
          ]}
          rows={down.slice(0, 8)}
          rowKey={(r) => `${r.sw}/${r.vrf}/${r.peer}`}
          onRow={(r) => navigate(`/switches/${encodeURIComponent(r.sw)}/troubleshoot?tab=bgp`)}
        />
      )}
      <Unread switches={switches} failed={each.failed} />
    </div>
  );
}

const PROTOCOL_COLORS = [
  'var(--color-series-1)',
  'var(--color-series-2)',
  'var(--color-series-3)',
  'var(--color-series-4)',
  'var(--color-series-5)',
  'var(--color-series-6)',
  'var(--color-series-7)',
  'var(--color-series-8)',
];

/** IPv4 routes across every VRF in scope, by the protocol that installed them. */
function RouteSummaryCard({ switches }: WidgetProps) {
  const ids = switches.map((s) => s.id);
  const each = useEach(
    ids,
    (id) => ['collect', id, 'rib-ipv4'],
    (id) => api.collect<unknown>(id, '/vrf', '/vrf/{key}/router/rib/ipv4/route', { rev: 'operational' }),
  );
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (each.loading) return <Quiet>Loading…</Quiet>;
  const rows = ids.flatMap((id) =>
    Object.entries(each.byId[id]?.data ?? {}).flatMap(([vrf, r]) => parseRoutes(r ?? {}, {}, vrf)),
  );
  const counts = protocolCounts(rows).map((c, i) => ({
    label: c.protocol,
    value: c.count,
    color: PROTOCOL_COLORS[i % PROTOCOL_COLORS.length] ?? 'var(--color-muted)',
  }));
  const vrfs = new Set(rows.map((r) => r.vrf)).size;
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <StatRow columns={2}>
        <Stat label="Routes" value={rows.length.toLocaleString()} sub="IPv4 entries" />
        <Stat label="VRFs" value={String(vrfs)} sub="holding routes" />
      </StatRow>
      {counts.length > 0 && (
        <>
          <StackBar parts={counts} />
          <Legend items={counts} />
        </>
      )}
      <Unread switches={switches} failed={each.failed} />
    </div>
  );
}

/** Switches whose running config differs from startup — what a reboot would lose. */
function UnsavedConfigCard({ switches }: WidgetProps) {
  const navigate = useNavigate();
  const ids = switches.map((s) => s.id);
  // Same keys and reads as Troubleshoot → Config (defaults off), so the cache is shared.
  const applied = useEach(
    ids,
    (id) => ['config', id, 'applied', false],
    (id) => api.query<Record<string, unknown>>(id, '/', { rev: 'applied', filled: false }),
  );
  const startup = useEach(
    ids,
    (id) => ['config', id, 'startup', false],
    (id) => api.query<Record<string, unknown>>(id, '/', { rev: 'startup', filled: false }),
  );
  if (switches.length === 0) return <Quiet>No switches yet.</Quiet>;
  if (applied.loading || startup.loading) return <Quiet>Loading…</Quiet>;
  const failed = [...new Set([...applied.failed, ...startup.failed])];
  const rows = ids
    .filter((id) => !failed.includes(id))
    .map((id) => ({
      id,
      changes: diffCommands(
        toCommands(startup.byId[id]?.data ?? {}),
        toCommands(applied.byId[id]?.data ?? {}),
      ).length,
    }));
  const dirty = rows.filter((r) => r.changes > 0);
  if (dirty.length === 0 && failed.length === 0) {
    return (
      <AllClear>
        {rows.length === 1 ? 'Running config is saved.' : `All ${rows.length} switches saved.`}
      </AllClear>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {dirty.length === 0 ? (
        <Quiet>{`${rows.length} switch${rows.length === 1 ? '' : 'es'} saved.`}</Quiet>
      ) : (
        <MiniTable
          cols={[
            { label: 'Switch', cell: (r: { id: string; changes: number }) => nameOf(switches, r.id) },
            {
              label: 'Unsaved',
              align: 'right' as const,
              cell: (r: { id: string; changes: number }) => (
                <Badge tone="warn">{`${r.changes} line${r.changes === 1 ? '' : 's'}`}</Badge>
              ),
            },
          ]}
          rows={dirty}
          rowKey={(r) => r.id}
          onRow={(r) => navigate(`/switches/${encodeURIComponent(r.id)}/troubleshoot?tab=config`)}
        />
      )}
      <Unread switches={switches} failed={failed} />
    </div>
  );
}

/** What every widget receives: the switches in scope, and the card chrome for widgets that draw their own. */
export interface WidgetProps {
  switches: SwitchRow[];
  /** Whole-inventory scope (fleet dashboard) as opposed to a group or one switch. */
  fleet?: boolean;
  groupId?: string;
  title: string;
  info?: string;
  onRemove?: () => void;
}

/**
 * Widget registry, mirrored by the server WIDGET_CATALOG (which also says
 * which dashboard kinds may show each one). Widgets are components (never
 * invoked as functions): their hooks must run unconditionally (React #310).
 * `ownCard` widgets draw their own Card (header actions); `wide` spans the row.
 */
export const WIDGETS: Record<
  string,
  {
    title: string;
    blurb: string;
    info?: string;
    wide?: boolean;
    ownCard?: boolean;
    Component: (props: WidgetProps) => React.ReactNode;
  }
> = {
  'fleet-stats': {
    title: 'At a glance',
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
  cpu: {
    title: 'CPU',
    blurb: 'Utilization, model and cores.',
    info: 'Current CPU utilization per switch, with the processor model, core count, used and free. Amber past 80%, red past 90%.',
    Component: CpuCard,
  },
  memory: {
    title: 'Memory',
    blurb: 'Utilization and sizes.',
    info: 'Physical memory utilization per switch, with total, used, buffers & cache, free and swap. Amber past 80%, red past 90%.',
    Component: MemoryCard,
  },
  'port-status': {
    title: 'Port status',
    blurb: 'Ports up, down and admin down.',
    info: 'Every port except loopbacks and VRF devices. Admin down = shut on purpose; down = enabled but no link.',
    Component: PortStatusCard,
  },
  traffic: {
    title: 'Traffic over time',
    blurb: 'Summed traffic with ranges, custom periods and compare.',
    info: 'Every port of every switch in scope added together: bits (or packets) per second received (In) and sent (Out). Compare draws a second period you pick as dashed lines over the view, start lined up with start.',
    wide: true,
    ownCard: true,
    Component: TrafficWidget,
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
  software: { title: 'Software & uptime', blurb: 'Release, build and uptime.', Component: SoftwareCard },
  'interfaces-by-device': {
    title: 'Interfaces by device',
    blurb: 'Live interface counts per switch.',
    Component: InterfacesByDeviceCard,
  },
  'recent-activity': { title: 'Recent activity', blurb: 'Audit trail tail.', Component: RecentActivityCard },
  connection: {
    title: 'Connection',
    blurb: 'Trust, reachability, address and groups.',
    Component: ConnectionCard,
  },
  members: {
    title: 'Members',
    blurb: 'Every member with health, release, uptime and load.',
    wide: true,
    Component: MembersCard,
  },
  temperatures: {
    title: 'Temperatures',
    blurb: 'Hottest sensors against their limits.',
    info: 'The hottest temperature sensors in scope. Amber at the sensor max, red at its critical mark.',
    Component: TemperaturesCard,
  },
  'flapping-ports': {
    title: 'Link flaps',
    blurb: 'Ports whose link went up and down.',
    info: 'Carrier transitions per port since the counters were last cleared, most first. A flapping link points at a cable, optic or far end.',
    Component: FlappingPortsCard,
  },
  'down-ports': {
    title: 'Ports without link',
    blurb: 'Enabled ports with no link.',
    info: 'Ports that are enabled but have no link (cable, optic or far end), listed apart from ports shut on purpose.',
    Component: DownPortsCard,
  },
  'bgp-sessions': {
    title: 'BGP sessions',
    blurb: 'Peers established vs down.',
    info: 'Every BGP peer in every VRF in scope. Sessions not established are listed; click one to open Troubleshoot → BGP.',
    Component: BgpSessionsCard,
  },
  'route-summary': {
    title: 'Routes by protocol',
    blurb: 'IPv4 routes per protocol across VRFs.',
    info: 'IPv4 route entries in every VRF in scope, split by the protocol that installed them (connected, static, BGP, OSPF…).',
    Component: RouteSummaryCard,
  },
  'unsaved-config': {
    title: 'Unsaved config',
    blurb: 'Running config not saved to startup.',
    info: 'Switches whose applied (running) configuration differs from startup — what a reboot would lose without nv config save. Click one to see the lines.',
    Component: UnsavedConfigCard,
  },
};

/**
 * Widget cards in the responsive grid (dense: later cards backfill holes).
 * `onChange` turns on customize mode: cards drag to reorder, arrows move
 * them a slot (keyboard and touch), × removes (never the last one).
 */
export function WidgetGrid({
  ids,
  switches,
  fleet,
  groupId,
  onChange,
}: {
  ids: string[];
  switches: SwitchRow[];
  fleet?: boolean;
  groupId?: string;
  onChange?: (ids: string[]) => void;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () =>
      setCols(getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length || 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const editing = onChange !== undefined;
  const shown = ids.filter((id) => WIDGETS[id]);
  // Dense flow backfills every hole but the last row; the last regular card
  // stretches over what is left so no row ends in an empty cell.
  const regular = shown.filter((id) => !WIDGETS[id]?.wide);
  const rest = regular.length % cols;
  const stretched = rest > 0 ? regular[regular.length - 1] : undefined;
  return (
    <div ref={gridRef} className="widget-grid">
      {shown.map((id, i) => {
        const w = WIDGETS[id];
        if (!w) return null;
        const { Component } = w;
        const props: WidgetProps = { switches, fleet, groupId, title: w.title, info: w.info };
        const target = editing && over === id && drag !== null && drag !== id;
        return (
          <div
            key={id}
            className={w.wide ? 'wide' : undefined}
            draggable={editing}
            onDragStart={(e) => {
              setDrag(id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', id);
            }}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              if (over !== id) setOver(id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (drag && drag !== id) onChange?.(moveWidget(shown, drag, id));
              setDrag(null);
              setOver(null);
            }}
            onDragEnd={() => {
              setDrag(null);
              setOver(null);
            }}
            style={{
              minWidth: 0,
              display: 'grid',
              position: 'relative',
              gridColumn: id === stretched ? `span ${cols - rest + 1}` : undefined,
              borderRadius: 12,
              opacity: drag === id ? 0.4 : 1,
              outline: target ? '2px solid var(--color-brand)' : undefined,
              outlineOffset: 3,
            }}
          >
            {w.ownCard ? (
              <Component {...props} />
            ) : (
              <Card title={w.title} info={w.info}>
                <Component {...props} />
              </Card>
            )}
            {editing && (
              <EditChrome
                title={w.title}
                onEarlier={i > 0 ? () => onChange(moveWidget(shown, id, shown[i - 1] ?? id)) : undefined}
                onLater={
                  i < shown.length - 1 ? () => onChange(moveWidget(shown, id, shown[i + 1] ?? id)) : undefined
                }
                onRemove={shown.length > 1 ? () => onChange(shown.filter((x) => x !== id)) : undefined}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Customize overlay: the whole card is the drag handle; corner buttons move or remove it. */
function EditChrome({
  title,
  onEarlier,
  onLater,
  onRemove,
}: {
  title: string;
  onEarlier?: () => void;
  onLater?: () => void;
  onRemove?: () => void;
}) {
  const btn = (label: string, glyph: string, onClick?: () => void) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={!onClick}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        display: 'inline-grid',
        placeItems: 'center',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-border)',
        borderRadius: 8,
        color: onClick ? 'var(--color-text)' : 'var(--color-border)',
        cursor: onClick ? 'pointer' : 'default',
        font: 'inherit',
        fontSize: 15,
      }}
    >
      {glyph}
    </button>
  );
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 12,
        border: '1px dashed var(--color-brand)',
        background: 'color-mix(in srgb, var(--color-bg) 62%, transparent)',
        cursor: 'grab',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6 }}>
        {btn(`Move ${title} earlier`, '←', onEarlier)}
        {btn(`Move ${title} later`, '→', onLater)}
        {btn(`Remove ${title}`, '×', onRemove)}
      </div>
      <span
        style={{
          fontSize: 13,
          color: 'var(--color-text)',
          userSelect: 'none',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-border)',
          borderRadius: 99,
          padding: '6px 12px',
        }}
      >
        <span aria-hidden="true">⠿ </span>
        {title} · drag to move
      </span>
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
