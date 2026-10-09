/**
 * Interface bridge membership (3B.2, the interface side of R13). One card
 * listing the bridge domains this interface joins — domain, access VLAN,
 * trunk VLANs, untagged — with Attach / Edit / Detach through the canonical
 * VlanAttachment (same Card + stage → dry-run → apply flow as every other
 * Config section). Group scope merges per-member values into mixed markers.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui.js';
import { Card } from '../../components/cards.js';
import { ValueGrid } from '../../components/resource.js';
import { MixedValue } from '../../components/mixed.js';
import { getPath } from '../../lib/format.js';
import { mergeValues } from '../../lib/merge.js';
import { displayValue } from '../iface/ConfigTab.js';
import { refreshInterfaces, usePerSwitch, type Scope } from '../iface/scope.js';
import { DetachPorts, VlanAttachment } from './VlanAttachment.js';

type Obj = Record<string, unknown>;

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Domains this interface joins on any member, in natural order. */
function attachedDomains(cfg: Record<string, Obj | undefined>): string[] {
  const names = new Set<string>();
  for (const obj of Object.values(cfg)) {
    const doms = getPath(obj, 'bridge/domain');
    if (doms && typeof doms === 'object' && !Array.isArray(doms)) {
      for (const d of Object.keys(doms)) names.add(d);
    }
  }
  return [...names].sort(natural);
}

export function IfaceBridgeSection({
  scope,
  ifaceId,
  present,
  cfg,
  onOpenSwitch,
}: {
  scope: Scope;
  ifaceId: string;
  /** Members holding this interface. */
  present: string[];
  /** Applied interface object per switch (the Config tab's read). */
  cfg: Record<string, Obj | undefined>;
  /** Open the interface on one member switch (mixed-value drill-in). */
  onOpenSwitch: (sw: string) => void;
}) {
  const queryClient = useQueryClient();
  const group = scope.kind === 'group';
  const [attaching, setAttaching] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [detaching, setDetaching] = useState<string | null>(null);
  // Live domain names for the Attach dropdown — backend data, never constants.
  const domains = usePerSwitch<Record<string, Obj>>(scope, '/bridge/domain', { rev: 'applied' });
  const domainNames = useMemo(() => {
    const names = new Set<string>();
    for (const sw of present) for (const d of Object.keys(domains.objects[sw] ?? {})) names.add(d);
    return [...names].sort(natural);
  }, [domains.objects, present]);

  // VlanAttachment reads S1 collections; narrow this interface's objects into that shape.
  const ifaces = useMemo(
    () => Object.fromEntries(present.map((sw) => [sw, cfg[sw] ? { [ifaceId]: cfg[sw]! } : undefined])),
    [present, cfg, ifaceId],
  );

  const attached = attachedDomains(Object.fromEntries(present.map((sw) => [sw, cfg[sw]])));
  const holdersOf = (dom: string) =>
    present.filter((sw) => getPath(cfg[sw], `bridge/domain/${dom}`) !== undefined);

  function cell(dom: string, leaf: string, label: string) {
    const m = mergeValues(
      Object.fromEntries(holdersOf(dom).map((sw) => [sw, displayValue(getPath(cfg[sw], `bridge/domain/${dom}/${leaf}`))])),
    );
    if (m.kind === 'none') return '—';
    if (m.kind === 'same') return m.value || '—';
    return <MixedValue groups={m.groups} label={`${ifaceId} ${dom} ${label}`} onOpen={onOpenSwitch} />;
  }

  const onApplied = () => refreshInterfaces(queryClient);

  return (
    <>
      <Card
        title="Bridge"
        hint={attached.length === 0 ? 'Not attached to a bridge domain' : undefined}
        actions={
          <Button
            auto
            variant="secondary"
            onClick={() => setAttaching(true)}
            disabled={domains.loading || domainNames.length === 0}
          >
            {attached.length === 0 ? 'Attach' : 'Attach another'}
          </Button>
        }
      >
        {attached.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: 0 }}>
            Join {ifaceId} to a bridge domain as an access or trunk port.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {attached.map((dom) => (
              <div key={dom}>
                <ValueGrid
                  items={[
                    { label: 'Domain', value: dom },
                    { label: 'Access VLAN', value: cell(dom, 'access', 'access VLAN') },
                    { label: 'VLANs', value: cell(dom, 'vlan', 'VLANs') },
                    { label: 'Untagged', value: cell(dom, 'untagged', 'untagged') },
                  ]}
                />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                  <Button auto variant="secondary" onClick={() => setEditing(dom)}>
                    Edit
                  </Button>
                  <Button auto variant="danger" onClick={() => setDetaching(dom)}>
                    Detach
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {group && attached.length > 0 && (
          <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '12px 0 0' }}>
            Values members disagree on read mixed — open one to drill in.
          </p>
        )}
      </Card>
      {attaching && domainNames.length > 0 && (
        <VlanAttachment
          scope={scope}
          members={present}
          domain={domainNames.find((d) => !attached.includes(d)) ?? domainNames[0]!}
          domains={domainNames}
          ports={[ifaceId]}
          lockPorts
          ifaces={ifaces}
          onClose={() => setAttaching(false)}
          onApplied={onApplied}
        />
      )}
      {editing && (
        <VlanAttachment
          scope={scope}
          members={holdersOf(editing)}
          domain={editing}
          ports={[ifaceId]}
          lockPorts
          ifaces={ifaces}
          onClose={() => setEditing(null)}
          onApplied={onApplied}
        />
      )}
      {detaching && (
        <DetachPorts
          scope={scope}
          domain={detaching}
          ports={[ifaceId]}
          members={holdersOf(detaching)}
          ifaces={ifaces}
          onClose={() => setDetaching(null)}
          onApplied={onApplied}
        />
      )}
    </>
  );
}
