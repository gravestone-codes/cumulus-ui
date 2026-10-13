/**
 * Troubleshoot: the switch's live forwarding and neighbor state, not its
 * config — routes (with a "which route would carry this IP" lookup and
 * per-route next hops), ARP/ND, MAC table, LLDP, BGP sessions and port
 * health — plus the running config as `nv config show` prints it. Each tab
 * reads only while open; per-member tables arrive in one backend fan-out
 * (`/collect`). Empty is said plainly, never as an error.
 */
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import {
  Alert,
  Badge,
  Breadcrumb,
  Button,
  FilterLine,
  Hint,
  Modal,
  Spinner,
  Tabs,
} from '../components/ui.js';
import { ReadError } from '../components/resource.js';
import { DataTable } from '../components/DataTable.js';
import { MiniTable, Stat, StatRow, bytes } from '../components/cards.js';
import { timeAgo, getPath } from '../lib/format.js';
import { usePorts, uptimeText, type PortRow } from '../lib/vitals.js';
import {
  longestMatch,
  parseBgp,
  parseIp,
  parseLldp,
  parseMacs,
  parseNeighbors,
  parseRoutes,
  protocolCounts,
  type RouteRow,
} from '../lib/troubleshoot.js';
import { ReadToolbar } from '../components/ReadToolbar.js';
import { ConfigTab } from './ConfigTab.js';
import { ScopeShell } from './iface/ScopeShell.js';

type Tab = 'routes' | 'arp' | 'mac' | 'lldp' | 'bgp' | 'ports' | 'config';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'routes', label: 'Routes' },
  { id: 'arp', label: 'ARP / ND' },
  { id: 'mac', label: 'MAC table' },
  { id: 'lldp', label: 'LLDP' },
  { id: 'bgp', label: 'BGP' },
  { id: 'ports', label: 'Port health' },
  { id: 'config', label: 'Config' },
];

const OP = { rev: 'operational' } as const;
const FRESH = 15_000;

export function Troubleshoot() {
  const { switchId = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'routes') as Tab;
  return (
    <ScopeShell scope={{ kind: 'switch', id: switchId }} active="/troubleshoot">
      <Breadcrumb
        trail={[{ label: switchId, to: `/switches/${switchId}` }, { label: 'Troubleshoot' }]}
        onNav={navigate}
      />
      <div className="list-head" style={{ gap: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
          Troubleshoot
          <Hint text="Live operational state read from the switch right now — what it is forwarding and who it sees — plus the configuration as the CLI prints it. Each tab reads when opened; Refresh re-reads." />
        </h1>
      </div>
      <Tabs tabs={TABS} active={tab} onChange={(id) => setParams({ tab: id }, { replace: true })} />
      {tab === 'routes' && <RoutesTab switchId={switchId} />}
      {tab === 'arp' && <ArpTab switchId={switchId} />}
      {tab === 'mac' && <MacTab switchId={switchId} />}
      {tab === 'lldp' && <LldpTab switchId={switchId} />}
      {tab === 'bgp' && <BgpTab switchId={switchId} />}
      {tab === 'ports' && <PortsTab switchId={switchId} />}
      {tab === 'config' && <ConfigTab switchId={switchId} />}
    </ScopeShell>
  );
}

/** Members that failed inside a fan-out read, named rather than hidden. */
function PartialErrors({ errors }: { errors?: Record<string, string> }) {
  const failed = Object.entries(errors ?? {});
  if (failed.length === 0) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <Alert tone="warn">
        Could not read {failed.length}: {failed.map(([k, e]) => `${k} (${e})`).join(', ')}
      </Alert>
    </div>
  );
}

const stateTone = (s: string): 'pass' | 'warn' | 'fail' | 'muted' =>
  /^(reachable|permanent|established|up)$/i.test(s)
    ? 'pass'
    : /^(failed|down|idle|active|connect)$/i.test(s)
      ? 'fail'
      : /^(incomplete|delay|probe|opensent|openconfirm)$/i.test(s)
        ? 'warn'
        : 'muted';

type Afi = 'ipv4' | 'ipv6';
const AFI_LABEL: Record<Afi, string> = { ipv4: 'IPv4', ipv6: 'IPv6' };

/**
 * Routes across every VRF in one fan-out read, filtered here by VRF and
 * protocol — the options come from what the switch returned (BGP, OSPF,
 * static, connected, kernel…), so new VRFs and protocols appear unprompted.
 */
function RoutesTab({ switchId }: { switchId: string }) {
  const [vrf, setVrf] = useState('');
  const [afi, setAfi] = useState<Afi>('ipv4');
  const [proto, setProto] = useState('');
  const [lookup, setLookup] = useState('');
  const [open, setOpen] = useState<RouteRow | null>(null);
  const routes = useQuery({
    queryKey: ['rib', switchId, afi],
    queryFn: async () => {
      const [rib, nh] = await Promise.all([
        api.collect<unknown>(switchId, '/vrf', `/vrf/{key}/router/rib/${afi}/route`, { rev: 'operational' }),
        api.query(switchId, '/router/nexthop/rib', OP).catch(() => ({ data: {} })),
      ]);
      return {
        vrfs: Object.keys(rib.data),
        rows: Object.entries(rib.data).flatMap(([v, r]) => parseRoutes(r ?? {}, nh.data, v)),
        errors: rib.errors,
      };
    },
    staleTime: FRESH,
    retry: false,
  });
  const all = routes.data?.rows ?? [];
  const vrfNames = routes.data?.vrfs ?? [];
  const inVrf = vrf ? all.filter((r) => r.vrf === vrf) : all;
  const rows = proto ? inVrf.filter((r) => r.protocol === proto) : inVrf;
  const protocols = protocolCounts(inVrf);

  // Longest match per VRF, over everything the RIB installed (protocol filter aside).
  const ip = lookup.trim();
  const parsed = ip === '' ? null : parseIp(ip);
  const valid = parsed?.v === (afi === 'ipv4' ? 4 : 6);
  const lookupVrfs = vrf ? [vrf] : vrfNames;
  const hits = valid
    ? lookupVrfs.map((v) => {
        const usable = all.filter((r) => r.vrf === v && (r.selected || r.installed));
        const prefix = longestMatch(
          ip,
          usable.map((r) => r.prefix),
        );
        return { vrf: v, row: usable.find((r) => r.prefix === prefix) };
      })
    : [];
  const scopeText = `${vrf ? `VRF ${vrf}` : 'any VRF'}${proto ? ` from ${proto}` : ''}`;
  return (
    <>
      <ReadToolbar q={routes}>
        <FilterLine
          label="VRF"
          value={vrf}
          options={[
            { value: '', label: `All VRFs (${vrfNames.length})` },
            ...vrfNames.map((v) => ({ value: v, label: `VRF ${v}` })),
          ]}
          onChange={setVrf}
          width={150}
        />
        <FilterLine
          label="Address family"
          value={afi}
          options={(['ipv4', 'ipv6'] as const).map((a) => ({ value: a, label: AFI_LABEL[a] }))}
          onChange={(v) => setAfi(v as Afi)}
          width={90}
        />
        <FilterLine
          label="Protocol"
          value={proto}
          options={[
            { value: '', label: 'All protocols' },
            ...protocols.map((p) => ({ value: p.protocol, label: `${p.protocol} (${p.count})` })),
            ...(proto && !protocols.some((p) => p.protocol === proto)
              ? [{ value: proto, label: `${proto} (0)` }]
              : []),
          ]}
          onChange={setProto}
          width={160}
        />
        <span className="lf" style={{ flex: 1, minWidth: 200, maxWidth: 300 }}>
          <input
            aria-label="Route lookup"
            placeholder={
              afi === 'ipv4' ? 'Which route carries… 10.1.2.3' : 'Which route carries… 2001:db8::1'
            }
            value={lookup}
            onChange={(e) => {
              setLookup(e.target.value);
              // Typing the other family's address flips the table to it.
              const v = parseIp(e.target.value)?.v;
              if (v === 4 && afi !== 'ipv4') setAfi('ipv4');
              if (v === 6 && afi !== 'ipv6') setAfi('ipv6');
            }}
          />
        </span>
      </ReadToolbar>
      <PartialErrors errors={routes.data?.errors} />
      {ip !== '' && !routes.isPending && (
        <div style={{ display: 'grid', gap: 8, marginBottom: 16, fontSize: 14 }}>
          {!parsed ? (
            <span style={{ color: 'var(--color-muted)' }}>Enter an IPv4 or IPv6 address.</span>
          ) : !valid ? (
            <span style={{ color: 'var(--color-muted)' }}>Reading {AFI_LABEL[afi]} routes…</span>
          ) : (
            hits.map((h) =>
              h.row ? (
                <span
                  key={h.vrf}
                  style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
                >
                  <Badge tone="pass">match</Badge>
                  <span style={{ color: 'var(--color-muted)' }}>VRF {h.vrf}:</span>
                  <strong>{ip}</strong> → <strong>{h.row.prefix}</strong>
                  <span style={{ color: 'var(--color-muted)' }}>
                    via {h.row.via} · {h.row.protocol}
                  </span>
                  <Button auto variant="secondary" onClick={() => h.row && setOpen(h.row)}>
                    Next hops
                  </Button>
                </span>
              ) : (
                <span
                  key={h.vrf}
                  style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
                >
                  <Badge tone="fail">no route</Badge>
                  <span style={{ color: 'var(--color-muted)' }}>
                    VRF {h.vrf}: nothing covers {ip} — the switch would drop it there.
                  </span>
                </span>
              ),
            )
          )}
        </div>
      )}
      {routes.isError ? (
        <ReadError switchId={switchId} message={routes.error.message} onFixed={() => routes.refetch()} />
      ) : (
        <DataTable<RouteRow>
          storageKey="cumulus.ts.routes.v2"
          loading={routes.isPending}
          rows={rows}
          rowKey={(r) => `${r.vrf}/${r.prefix}#${r.entry}`}
          onRowClick={setOpen}
          empty={
            <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>
              No {AFI_LABEL[afi]} routes in {scopeText}.
            </p>
          }
          cols={[
            { key: 'prefix', label: 'Prefix', always: true, value: (r) => r.prefix },
            { key: 'vrf', label: 'VRF', value: (r) => r.vrf },
            { key: 'protocol', label: 'Protocol', value: (r) => r.protocol },
            { key: 'via', label: 'Via', value: (r) => r.via },
            {
              key: 'pref',
              label: 'Dist / metric',
              value: (r) => `${r.distance ?? '—'} / ${r.metric ?? '—'}`,
            },
            {
              key: 'state',
              label: 'State',
              value: (r) =>
                r.failed ? 'failed' : r.selected ? 'best' : r.installed ? 'installed' : 'candidate',
              render: (r) =>
                r.failed ? (
                  <Badge tone="fail">failed</Badge>
                ) : r.selected ? (
                  <Badge tone="pass">best</Badge>
                ) : r.installed ? (
                  <Badge tone="pass">installed</Badge>
                ) : (
                  <Badge>candidate</Badge>
                ),
            },
            { key: 'age', label: 'Age', value: (r) => (r.uptime ? timeAgo(r.uptime) : '—') },
          ]}
        />
      )}
      {open && <RouteDetail switchId={switchId} afi={afi} row={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** One route's entries and next hops, read on open (the list omits via entries). */
function RouteDetail({
  switchId,
  afi,
  row,
  onClose,
}: {
  switchId: string;
  afi: string;
  row: RouteRow;
  onClose: () => void;
}) {
  const vrf = row.vrf;
  const detail = useQuery({
    queryKey: ['rib-route', switchId, vrf, afi, row.prefix],
    queryFn: () =>
      api.query<Record<string, unknown>>(
        switchId,
        `/vrf/${encodeURIComponent(vrf)}/router/rib/${afi}/route/${encodeURIComponent(row.prefix)}`,
        OP,
      ),
    retry: false,
  });
  type Hop = { entry: string; protocol: string; via: string; iface: string; type: string; flags: string };
  const hops: Hop[] = Object.entries(
    (getPath(detail.data?.data, 'route-entry') as Record<string, unknown>) ?? {},
  ).flatMap(([entry, e]) => {
    const vias = Object.values((getPath(e, 'via-entry') as Record<string, unknown>) ?? {});
    const base = { entry, protocol: String(getPath(e, 'protocol') ?? '—') };
    if (vias.length === 0) return [{ ...base, via: '—', iface: '—', type: '—', flags: '' }];
    return vias.map((v) => ({
      ...base,
      via: String(getPath(v, 'via') ?? '—'),
      iface: String(getPath(v, 'interface') ?? '—'),
      type: String(getPath(v, 'type') ?? '—'),
      flags: String(getPath(v, 'flags-string') ?? ''),
    }));
  });
  return (
    <Modal open onClose={onClose} title={`${row.prefix} · VRF ${vrf}`} width={640}>
      {detail.isPending ? (
        <Spinner label="Reading route" />
      ) : detail.isError ? (
        <Alert tone="fail">{detail.error.message}</Alert>
      ) : (
        <MiniTable
          cols={[
            { label: 'Protocol', cell: (h: Hop) => h.protocol },
            { label: 'Via', cell: (h: Hop) => h.via },
            { label: 'Interface', cell: (h: Hop) => h.iface },
            { label: 'Type', cell: (h: Hop) => h.type },
            { label: 'Flags', cell: (h: Hop) => h.flags || '—' },
          ]}
          rows={hops}
          rowKey={(h) => `${h.entry}/${h.via}/${h.iface}`}
        />
      )}
    </Modal>
  );
}

function useCollect<T>(switchId: string, key: string, each: string, path: string, eachRev?: string) {
  return useQuery({
    queryKey: ['collect', switchId, key],
    queryFn: () =>
      api.collect<T>(switchId, each, path, { rev: 'operational', ...(eachRev ? { eachRev } : {}) }),
    staleTime: FRESH,
    retry: false,
  });
}

function ArpTab({ switchId }: { switchId: string }) {
  const q = useCollect(switchId, 'arp', '/interface', '/interface/{key}/ip/neighbor');
  const rows = parseNeighbors(q.data?.data ?? {});
  return (
    <>
      <ReadToolbar q={q} />
      <PartialErrors errors={q.data?.errors} />
      {q.isError ? (
        <ReadError switchId={switchId} message={q.error.message} onFixed={() => q.refetch()} />
      ) : (
        <DataTable
          storageKey="cumulus.ts.arp.v1"
          loading={q.isPending}
          rows={rows}
          rowKey={(r) => `${r.iface}/${r.ip}`}
          empty={<p style={{ color: 'var(--color-muted)', fontSize: 14 }}>No ARP or ND entries.</p>}
          cols={[
            { key: 'ip', label: 'IP address', always: true, value: (r) => r.ip },
            { key: 'mac', label: 'MAC', value: (r) => r.mac },
            { key: 'iface', label: 'Interface', value: (r) => r.iface },
            { key: 'family', label: 'Family', value: (r) => (r.family === 'ipv4' ? 'ARP' : 'ND') },
            {
              key: 'state',
              label: 'State',
              value: (r) => r.state,
              render: (r) => <Badge tone={stateTone(r.state)}>{r.state}</Badge>,
            },
            { key: 'router', label: 'Router', value: (r) => (r.router ? 'yes' : '') },
          ]}
        />
      )}
    </>
  );
}

function MacTab({ switchId }: { switchId: string }) {
  const q = useCollect(switchId, 'mac', '/bridge/domain', '/bridge/domain/{key}/mac-table', 'applied');
  const rows = parseMacs(q.data?.data ?? {});
  return (
    <>
      <ReadToolbar q={q} />
      <PartialErrors errors={q.data?.errors} />
      {q.isError ? (
        <ReadError switchId={switchId} message={q.error.message} onFixed={() => q.refetch()} />
      ) : (
        <DataTable
          storageKey="cumulus.ts.mac.v1"
          loading={q.isPending}
          rows={rows}
          rowKey={(r) => `${r.domain}/${r.mac}/${r.vlan ?? ''}/${r.iface}`}
          empty={<p style={{ color: 'var(--color-muted)', fontSize: 14 }}>No MAC addresses learned.</p>}
          cols={[
            { key: 'mac', label: 'MAC', always: true, value: (r) => r.mac },
            { key: 'vlan', label: 'VLAN', value: (r) => (r.vlan === undefined ? '—' : String(r.vlan)) },
            { key: 'iface', label: 'Interface', value: (r) => r.iface },
            { key: 'type', label: 'Type', value: (r) => r.type },
            { key: 'remote', label: 'Remote VTEP', value: (r) => r.remote || '—' },
            { key: 'age', label: 'Age', value: (r) => (r.age === undefined ? '—' : `${r.age}s`) },
            { key: 'domain', label: 'Bridge', value: (r) => r.domain },
          ]}
        />
      )}
    </>
  );
}

function LldpTab({ switchId }: { switchId: string }) {
  const navigate = useNavigate();
  const q = useCollect(switchId, 'lldp', '/interface', '/interface/{key}/lldp/neighbor');
  const rows = parseLldp(q.data?.data ?? {});
  return (
    <>
      <ReadToolbar q={q} />
      <PartialErrors errors={q.data?.errors} />
      {q.isError ? (
        <ReadError switchId={switchId} message={q.error.message} onFixed={() => q.refetch()} />
      ) : (
        <DataTable
          storageKey="cumulus.ts.lldp.v1"
          loading={q.isPending}
          rows={rows}
          rowKey={(r) => `${r.iface}/${r.id}`}
          onRowClick={(r) => navigate(`/switches/${switchId}/interfaces/${encodeURIComponent(r.iface)}`)}
          empty={
            <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>
              No LLDP neighbors — nothing cabled is announcing itself.
            </p>
          }
          cols={[
            { key: 'iface', label: 'Local port', always: true, value: (r) => r.iface },
            { key: 'system', label: 'Neighbor', value: (r) => r.system },
            { key: 'port', label: 'Neighbor port', value: (r) => r.port },
            { key: 'mgmt', label: 'Mgmt address', value: (r) => r.mgmt },
          ]}
        />
      )}
    </>
  );
}

function BgpTab({ switchId }: { switchId: string }) {
  const q = useCollect(switchId, 'bgp', '/vrf', '/vrf/{key}/router/bgp/neighbor');
  const rows = parseBgp(q.data?.data ?? {});
  const up = rows.filter((r) => r.established).length;
  return (
    <>
      <ReadToolbar q={q} />
      <PartialErrors errors={q.data?.errors} />
      {q.isError ? (
        <ReadError switchId={switchId} message={q.error.message} onFixed={() => q.refetch()} />
      ) : q.isPending ? (
        <Spinner label="Reading BGP" />
      ) : rows.length === 0 ? (
        <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>
          BGP is not running on any VRF of this switch.
        </p>
      ) : (
        <>
          <div style={{ marginBottom: 20 }}>
            <StatRow columns={3}>
              <Stat label="Peers" value={String(rows.length)} />
              <Stat label="Established" value={String(up)} tone={up > 0 ? 'var(--color-pass)' : undefined} />
              <Stat
                label="Down"
                value={String(rows.length - up)}
                tone={rows.length - up > 0 ? 'var(--color-fail)' : undefined}
              />
            </StatRow>
          </div>
          <DataTable
            storageKey="cumulus.ts.bgp.v1"
            rows={rows}
            rowKey={(r) => `${r.vrf}/${r.peer}`}
            cols={[
              { key: 'peer', label: 'Peer', always: true, value: (r) => r.peer },
              { key: 'host', label: 'Hostname', value: (r) => r.hostname || '—' },
              { key: 'as', label: 'Remote AS', value: (r) => r.remoteAs },
              {
                key: 'state',
                label: 'State',
                value: (r) => r.state,
                render: (r) => <Badge tone={stateTone(r.state)}>{r.state}</Badge>,
              },
              { key: 'uptime', label: 'Up for', value: (r) => (r.established ? uptimeText(r.uptime) : '—') },
              { key: 'rx', label: 'Prefixes in', value: (r) => (r.rx === undefined ? '—' : String(r.rx)) },
              { key: 'tx', label: 'Prefixes out', value: (r) => (r.tx === undefined ? '—' : String(r.tx)) },
              { key: 'vrf', label: 'VRF', value: (r) => r.vrf },
              { key: 'reset', label: 'Last reset', value: (r) => r.lastReset || '—' },
            ]}
          />
        </>
      )}
    </>
  );
}

function PortsTab({ switchId }: { switchId: string }) {
  const navigate = useNavigate();
  const p = usePorts([switchId]);
  const troubled = p.rows.filter((r) => r.errors + r.drops > 0 || r.state === 'down');
  const flapping = p.rows.filter((r) => r.flaps > 2);
  return (
    <>
      {!p.loading && (
        <div style={{ marginBottom: 20 }}>
          <StatRow columns={3}>
            <Stat label="Ports" value={String(p.rows.length)} />
            <Stat
              label="Errors / down"
              value={String(troubled.length)}
              tone={troubled.length > 0 ? 'var(--color-fail)' : 'var(--color-pass)'}
            />
            <Stat
              label="Flapping"
              value={String(flapping.length)}
              sub="> 2 carrier transitions"
              tone={flapping.length > 0 ? 'var(--color-warn)' : undefined}
            />
          </StatRow>
        </div>
      )}
      <DataTable<PortRow>
        storageKey="cumulus.ts.ports.v1"
        loading={p.loading}
        rows={p.rows}
        rowKey={(r) => r.name}
        onRowClick={(r) => navigate(`/switches/${switchId}/interfaces/${encodeURIComponent(r.name)}`)}
        cols={[
          { key: 'name', label: 'Port', always: true, value: (r) => r.name },
          {
            key: 'state',
            label: 'State',
            value: (r) => r.state,
            render: (r) => (
              <Badge tone={r.state === 'up' ? 'pass' : r.state === 'down' ? 'fail' : 'muted'}>
                {r.state === 'admin-down' ? 'admin down' : r.state}
              </Badge>
            ),
          },
          { key: 'errors', label: 'Errors', value: (r) => String(r.errors) },
          { key: 'drops', label: 'Drops', value: (r) => String(r.drops) },
          { key: 'flaps', label: 'Flaps', value: (r) => String(r.flaps) },
          { key: 'in', label: 'In', value: (r) => bytes(r.inBytes) },
          { key: 'out', label: 'Out', value: (r) => bytes(r.outBytes) },
          { key: 'type', label: 'Type', value: (r) => r.type },
        ]}
      />
    </>
  );
}
