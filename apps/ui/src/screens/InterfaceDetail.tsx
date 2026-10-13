/**
 * Interface detail (3A.2–3A.7, 3B.3) for one switch or a whole group — same
 * page, same tabs (design §2, §3, §8B). Statistics · Config · Neighbors;
 * actions in the kebab. Statistics links out to the MACs learned on this
 * port (each attached domain's MAC tab, filtered). A group reads every
 * member; members lacking the interface are named in the header and never
 * touched by edits (design §5A).
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Breadcrumb, Spinner } from '../components/ui.js';
import { Card } from '../components/cards.js';
import { ResourceDetail } from '../components/resource.js';
import { presence } from '../lib/merge.js';
import { getPath } from '../lib/format.js';
import { InterfaceStats, TrafficPanel } from './iface/Traffic.js';
import { GroupTraffic } from './iface/GroupTraffic.js';
import { CountersCard, PhyCard, TransceiverCard } from './iface/StatsExtras.js';
import { ConfigTab } from './iface/ConfigTab.js';
import { displayValue } from '../lib/format.js';
import { IfaceBridgeSection } from './bridge/IfaceBridgeSection.js';
import { NeighborsTab } from './iface/NeighborsTab.js';
import { InterfaceActions } from './iface/Actions.js';
import { ScopeShell } from './iface/ScopeShell.js';
import { sectionsFor } from './iface/sections.js';
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
  const base = scopeBase(scope);
  const { present } = presence(oper.members, oper.objects);
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
      <ResourceDetail
        scope={scope}
        kind="interface"
        id={ifaceId}
        tabs={[
          {
            id: 'statistics',
            label: 'Statistics',
            content: (
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
                    <TrafficPanel switchId={scope.id} ifaceId={ifaceId} />
                  </>
                )}
                <CountersCard scope={scope} ifaceId={ifaceId} present={present} />
                {type === 'swp' && <TransceiverCard scope={scope} ifaceId={ifaceId} present={present} />}
                {scope.kind === 'switch' && type === 'swp' && (
                  <PhyCard switchId={scope.id} ifaceId={ifaceId} />
                )}
                {!cfg.loading && <LearnedMacs scope={scope} ifaceId={ifaceId} cfg={cfg.objects} />}
              </div>
            ),
          },
          {
            id: 'config',
            label: 'Config',
            content: cfg.loading ? (
              <Spinner label="Loading configuration" />
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
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
                <IfaceBridgeSection
                  scope={scope}
                  ifaceId={ifaceId}
                  present={present}
                  cfg={cfg.objects}
                  onOpenSwitch={(sw) =>
                    navigate(`/switches/${encodeURIComponent(sw)}/interfaces/${encodeURIComponent(ifaceId)}`)
                  }
                />
              </div>
            ),
          },
          {
            id: 'neighbors',
            label: 'Neighbors',
            content: <NeighborsTab scope={scope} ifaceId={ifaceId} present={present} />,
          },
        ]}
        activeTab={tab}
        onTabChange={(id) => setTab(id as Tab)}
        actions={<InterfaceActions scope={scope} ifaceId={ifaceId} present={present} type={type} />}
        read={oper}
        present={present}
      />
    </ScopeShell>
  );
}

/**
 * "MACs learned on this port" (3B.3): every attached bridge domain links to
 * its MAC tab filtered to this interface — the same table, not a copy.
 * Hidden until the port joins a domain.
 */
function LearnedMacs({
  scope,
  ifaceId,
  cfg,
}: {
  scope: Scope;
  ifaceId: string;
  cfg: Record<string, Record<string, unknown> | undefined>;
}) {
  const navigate = useNavigate();
  const base = scopeBase(scope);
  const domains = [
    ...new Set(
      Object.values(cfg).flatMap((o) =>
        Object.keys((getPath(o, 'bridge/domain') as Record<string, unknown> | undefined) ?? {}),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (domains.length === 0) return null;
  return (
    <Card title="MACs learned on this port">
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {domains.map((dom) => (
          <button
            key={dom}
            type="button"
            onClick={() => navigate(`${base}/bridge/${enc(dom)}?tab=macs&iface=${enc(ifaceId)}`)}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              font: 'inherit',
              fontSize: 14,
              color: 'var(--color-brand)',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
            }}
          >
            {dom}
          </button>
        ))}
      </div>
    </Card>
  );
}

const enc = encodeURIComponent;
