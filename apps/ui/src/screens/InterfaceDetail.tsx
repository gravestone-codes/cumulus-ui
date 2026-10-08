/**
 * Interface detail (3A.2–3A.7) for one switch or a whole group — same page,
 * same tabs (design §2, §3, §8B). Statistics · Config · Neighbors; actions
 * in the kebab. A group reads every member; members lacking the interface
 * are named in the header and never touched by edits (design §5A).
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Breadcrumb, Spinner, Tabs } from '../components/ui.js';
import { ReadError } from '../components/resource.js';
import { presence } from '../lib/merge.js';
import { getPath } from '../lib/format.js';
import { InterfaceStats, InterfaceTraffic } from './iface/Traffic.js';
import { GroupTraffic } from './iface/GroupTraffic.js';
import { CountersCard, PhyCard, TransceiverCard } from './iface/StatsExtras.js';
import { ConfigTab, displayValue } from './iface/ConfigTab.js';
import { NeighborsTab } from './iface/NeighborsTab.js';
import { InterfaceActions } from './iface/Actions.js';
import { ScopeShell } from './iface/ScopeShell.js';
import { sectionsFor } from './iface/sections.js';
import { PresenceBanner } from './iface/Presence.js';
import { scopeBase, usePerSwitch, type Scope } from './iface/scope.js';

type Tab = 'statistics' | 'config' | 'neighbors';

export function InterfaceDetail() {
  const { switchId, groupId, ifaceId = '' } = useParams();
  const scope: Scope = groupId ? { kind: 'group', id: groupId } : { kind: 'switch', id: switchId ?? '' };
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('statistics');
  const path = `/interface/${ifaceId}`;
  const oper = usePerSwitch(scope, path);
  const cfg = usePerSwitch(scope, path, { rev: 'applied' });
  const group = scope.kind === 'group';
  const base = scopeBase(scope);
  const { present, absent } = presence(oper.members, oper.objects);
  const failed = Object.keys(oper.errors);
  const absentOnly = absent.filter((sw) => !failed.includes(sw));
  const type = present.map((sw) => displayValue(oper.objects[sw]?.['type'])).find(Boolean);
  const cfgType = present
    .map((sw) => displayValue(getPath(cfg.objects[sw] ?? oper.objects[sw], 'type')))
    .find(Boolean);

  return (
    <ScopeShell scope={scope} active="/interfaces">
      <Breadcrumb
        trail={[
          { label: scope.id, to: base },
          { label: 'Interfaces', to: `${base}/interfaces` },
          { label: ifaceId },
        ]}
        onNav={navigate}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>{ifaceId}</h1>
        {group && !oper.loading && (
          <span
            style={{
              fontSize: 13,
              color: absentOnly.length > 0 ? 'var(--color-warn)' : 'var(--color-muted)',
            }}
          >
            on {present.length} of {oper.members.length} switch{oper.members.length === 1 ? '' : 'es'}
            {absentOnly.length > 0 && ` · absent on ${absentOnly.join(', ')}`}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {present.length > 0 && (
          <InterfaceActions scope={scope} ifaceId={ifaceId} present={present} type={type} />
        )}
      </div>
      {oper.error ? (
        <ReadError switchId={group ? '' : scope.id} message={oper.error.message} onFixed={oper.refetch} />
      ) : oper.loading ? (
        <Spinner label="Loading interface" />
      ) : present.length === 0 ? (
        <Alert tone="warn">
          {ifaceId} does not exist on {group ? 'any switch in this group' : scope.id}.
        </Alert>
      ) : (
        <>
          <PresenceBanner members={present} path={path} label={ifaceId} group={group} />
          {failed.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Alert tone="warn">
                Could not read {failed.map((sw) => `${sw} (${oper.errors[sw]})`).join(', ')} — shown without
                {failed.length === 1 ? ' it' : ' them'}.
              </Alert>
            </div>
          )}
          <Tabs
            tabs={[
              { id: 'statistics', label: 'Statistics' },
              { id: 'config', label: 'Config' },
              { id: 'neighbors', label: 'Neighbors' },
            ]}
            active={tab}
            onChange={(id) => setTab(id as Tab)}
          />
          {tab === 'statistics' ? (
            <div style={{ display: 'grid', gap: 12 }}>
              {scope.kind === 'group' ? (
                <GroupTraffic
                  groupId={scope.id}
                  ifaceId={ifaceId}
                  members={oper.members}
                  present={present}
                  oper={oper.objects}
                />
              ) : (
                <>
                  <InterfaceStats switchId={scope.id} path={path} />
                  <InterfaceTraffic switchId={scope.id} ifaceId={ifaceId} path={path} />
                </>
              )}
              <CountersCard scope={scope} ifaceId={ifaceId} present={present} />
              {type === 'swp' && <TransceiverCard scope={scope} ifaceId={ifaceId} present={present} />}
              {scope.kind === 'switch' && type === 'swp' && <PhyCard switchId={scope.id} ifaceId={ifaceId} />}
            </div>
          ) : tab === 'config' ? (
            cfg.loading ? (
              <Spinner label="Loading configuration" />
            ) : (
              <ConfigTab
                scope={scope}
                objectPath={path}
                name={ifaceId}
                sections={sectionsFor(cfgType)}
                cfg={cfg.objects}
                oper={oper.objects}
                present={present}
                onOpenSwitch={(sw) =>
                  navigate(`/switches/${encodeURIComponent(sw)}/interfaces/${encodeURIComponent(ifaceId)}`)
                }
              />
            )
          ) : (
            <NeighborsTab scope={scope} ifaceId={ifaceId} present={present} />
          )}
        </>
      )}
    </ScopeShell>
  );
}
