/**
 * Bridge domain detail (3B.1) for one switch or a group — Config · VLANs ·
 * Ports. Config is the interface section pattern (stage → dry-run → apply,
 * OCC) over `/bridge/domain/{id}`; VLANs lists the VLAN↔VNI map; Ports are
 * the interfaces (S1) whose config joins this domain. Presence comes from
 * applied config: a domain without member ports has no operational state.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Breadcrumb, Spinner, Tabs } from '../components/ui.js';
import { ReadError } from '../components/resource.js';
import { MergedList, type MergedColumn } from '../components/MergedList.js';
import { presence } from '../lib/merge.js';
import { getPath } from '../lib/format.js';
import { ConfigTab, displayValue } from './iface/ConfigTab.js';
import { ScopeShell } from './iface/ScopeShell.js';
import { PresenceBanner } from './iface/Presence.js';
import { scopeBase, usePerSwitch, type Scope } from './iface/scope.js';
import { DOMAIN_SECTIONS } from './bridge/sections.js';
import { domainPorts, domainVlans } from './bridge/members.js';

type Obj = Record<string, unknown>;
type Tab = 'config' | 'vlans' | 'ports';

const VLAN_COLUMNS: MergedColumn[] = [
  { key: 'vni', label: 'VNI', get: (o) => displayValue(getPath(o, 'vni')) },
  { key: 'ptp', label: 'PTP', get: (o) => displayValue(getPath(o, 'ptp/enable')) },
];

const PORT_COLUMNS: MergedColumn[] = [
  { key: 'state', label: 'State', get: (o) => String(o?.['state'] ?? '') },
  { key: 'access', label: 'Access VLAN', get: (o) => String(o?.['access'] ?? '') },
  { key: 'vlans', label: 'VLANs', get: (o) => String(o?.['vlans'] ?? '') },
  { key: 'untagged', label: 'Untagged', get: (o) => String(o?.['untagged'] ?? '') },
  { key: 'learning', label: 'Learning', get: (o) => String(o?.['learning'] ?? '') },
];

const enc = encodeURIComponent;

export function BridgeDomainDetail() {
  const { switchId, groupId, domainId = '' } = useParams();
  const scope: Scope = groupId ? { kind: 'group', id: groupId } : { kind: 'switch', id: switchId ?? '' };
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('config');
  const path = `/bridge/domain/${domainId}`;
  const cfg = usePerSwitch(scope, path, { rev: 'applied' });
  const group = scope.kind === 'group';
  const base = scopeBase(scope);
  const { present, absent } = presence(cfg.members, cfg.objects);
  const failed = Object.keys(cfg.errors);
  const absentOnly = absent.filter((sw) => !failed.includes(sw));

  return (
    <ScopeShell scope={scope} active="/bridge">
      <Breadcrumb
        trail={[
          { label: scope.id, to: base },
          { label: 'Bridge', to: `${base}/bridge` },
          { label: domainId },
        ]}
        onNav={navigate}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{domainId}</h1>
        {group && !cfg.loading && (
          <span
            style={{
              fontSize: 13,
              color: absentOnly.length > 0 ? 'var(--color-warn)' : 'var(--color-muted)',
            }}
          >
            on {present.length} of {cfg.members.length} switch{cfg.members.length === 1 ? '' : 'es'}
            {absentOnly.length > 0 && ` · absent on ${absentOnly.join(', ')}`}
          </span>
        )}
      </div>
      {cfg.error ? (
        <ReadError switchId={group ? '' : scope.id} message={cfg.error.message} onFixed={cfg.refetch} />
      ) : cfg.loading ? (
        <Spinner label="Loading bridge domain" />
      ) : present.length === 0 ? (
        <Alert tone="warn">
          {domainId} does not exist on {group ? 'any switch in this group' : scope.id}.
        </Alert>
      ) : (
        <>
          <PresenceBanner members={present} path={path} label={domainId} group={group} />
          {failed.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Alert tone="warn">
                Could not read {failed.map((sw) => `${sw} (${cfg.errors[sw]})`).join(', ')} — shown without
                {failed.length === 1 ? ' it' : ' them'}.
              </Alert>
            </div>
          )}
          <Tabs
            tabs={[
              { id: 'config', label: 'Config' },
              { id: 'vlans', label: 'VLANs' },
              { id: 'ports', label: 'Ports' },
            ]}
            active={tab}
            onChange={(id) => setTab(id as Tab)}
          />
          {tab === 'config' ? (
            <ConfigTab
              scope={scope}
              objectPath={path}
              name={domainId}
              sections={DOMAIN_SECTIONS}
              cfg={cfg.objects}
              oper={{}}
              present={present}
              onOpenSwitch={(sw) => navigate(`/switches/${enc(sw)}/bridge/${enc(domainId)}`)}
            />
          ) : tab === 'vlans' ? (
            <MergedList
              group={group}
              noun="VLANs"
              members={present}
              objects={Object.fromEntries(present.map((sw) => [sw, domainVlans(cfg.objects[sw])]))}
              loading={false}
              refetch={cfg.refetch}
              columns={VLAN_COLUMNS}
              storageKey="cumulus.bridge-vlans.v1"
            />
          ) : (
            <PortsTab scope={scope} domainId={domainId} present={present} />
          )}
        </>
      )}
    </ScopeShell>
  );
}

/** Member ports: interface config that joins this domain, with live link state. */
function PortsTab({ scope, domainId, present }: { scope: Scope; domainId: string; present: string[] }) {
  const navigate = useNavigate();
  const base = scopeBase(scope);
  const applied = usePerSwitch<Record<string, Obj>>(scope, '/interface', { rev: 'applied' });
  const oper = usePerSwitch<Record<string, Obj>>(scope, '/interface');
  return (
    <MergedList
      group={scope.kind === 'group'}
      noun="member ports"
      members={present}
      objects={Object.fromEntries(
        present.map((sw) => [sw, domainPorts(applied.objects[sw], oper.objects[sw], domainId)]),
      )}
      errors={applied.errors}
      loading={applied.loading || oper.loading}
      error={applied.error}
      refetch={applied.refetch}
      columns={PORT_COLUMNS}
      storageKey="cumulus.bridge-ports.v1"
      onOpen={(name) => navigate(`${base}/interfaces/${enc(name)}`)}
      onOpenSwitch={(sw, name) => navigate(`/switches/${enc(sw)}/interfaces/${enc(name)}`)}
    />
  );
}
