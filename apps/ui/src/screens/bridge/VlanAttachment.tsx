/**
 * VlanAttachment (R13, roadmap 3B.2): the one place ports join a bridge
 * domain. Launched from the domain (ports picked) or from an interface
 * (port fixed, domain picked from the live collection). Ports — swp and
 * bonds alike — come from the InterfacePicker over S1 reads; no bond state
 * lives here (3B identity check). Writes ride ChangeFlow (stage → dry-run →
 * apply, OCC), so the dry-run diff is the confirmation (service-affecting,
 * roadmap §6.6).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type StageCall } from '../../lib/api.js';
import { Alert, Button, LineDropdown, LineField, Modal, useToast } from '../../components/ui.js';
import { InterfacePicker } from '../../components/InterfacePicker.js';
import { boundsOf, leafSchema } from '../../lib/fieldSchema.js';
import { bondedPorts, pickerOptions } from '../../lib/interfacePicker.js';
import { mergeValues } from '../../lib/merge.js';
import { ChangeFlow } from '../iface/ChangeFlow.js';
import { useHeartbeat } from '../iface/Presence.js';
import { refreshInterfaces, type Scope } from '../iface/scope.js';
import {
  invalidAttach,
  planAttachCalls,
  planDetachCalls,
  portAttachment,
  VID_BOUNDS,
  type AttachInput,
  type AttachMode,
} from './attach.js';

type IfaceObj = Record<string, unknown>;
type Ifaces = Record<string, Record<string, IfaceObj> | undefined>;

/** Spec bounds for the access VID leaf; the compiled range is the fallback. */
function useVidBounds(domain: string) {
  const q = useQuery({
    queryKey: ['spec-fields', 'interface-bridge-domain', domain],
    queryFn: () => api.fields(`/interface/x/bridge/domain/${domain}`, 'PATCH'),
    staleTime: Infinity,
  });
  const bounds = boundsOf(leafSchema(q.data?.schema, 'access'));
  return { min: bounds.min ?? VID_BOUNDS.min, max: bounds.max ?? VID_BOUNDS.max, loading: q.isPending };
}

/** Current attachment per switch per port for `domain` (absent = detached). */
function currentOf(ifaces: Ifaces, domain: string, sw: string, port: string) {
  return portAttachment(ifaces[sw]?.[port], domain);
}

export function VlanAttachment({
  scope,
  members,
  domain,
  domains,
  ports,
  lockPorts = false,
  ifaces,
  onClose,
  onApplied,
}: {
  scope: Scope;
  /** Switches to stage on (domain holders / interface holders). */
  members: string[];
  /** Fixed domain (domain side) or initial domain (interface side). */
  domain: string;
  /** When set, the domain is a dropdown over these live collection names. */
  domains?: string[];
  /** Initially picked ports. */
  ports: string[];
  /** Hide the port picker (interface side: the port is fixed). */
  lockPorts?: boolean;
  /** Each member's applied interface collection (S1 reads drive picker + current). */
  ifaces: Ifaces;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const group = scope.kind === 'group';
  const [selected, setSelected] = useState(domain);
  const [picked, setPicked] = useState<string[]>(ports);
  const [mode, setMode] = useState<AttachMode>('access');
  const [access, setAccess] = useState('');
  const [vlans, setVlans] = useState('');
  const [untagged, setUntagged] = useState('');
  const [plan, setPlan] = useState<{ calls: Record<string, StageCall[]>; unchanged: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const vid = useVidBounds(selected);
  useHeartbeat(members, `/bridge/domain/${selected}`);

  const bonded = useMemo(() => bondedPorts(ifaces), [ifaces]);
  const options = useMemo(
    () => pickerOptions(members, ifaces, { types: ['swp', 'bond'], exclude: bonded }),
    [members, ifaces, bonded],
  );

  // Single-port edit: prefill from the first holder; group disagreement
  // reads as mixed below, and saving aligns every member (mirrored write).
  const single = picked.length === 1 ? picked[0]! : null;
  const holders = useMemo(
    () => (single ? members.filter((sw) => currentOf(ifaces, selected, sw, single)) : []),
    [members, ifaces, selected, single],
  );
  const merged = (pick: (sw: string) => string) =>
    mergeValues(Object.fromEntries(holders.map((sw) => [sw, pick(sw)])));
  const mixedNote = useMemo(() => {
    if (!single || holders.length < 2) return null;
    const parts: string[] = [];
    const a = merged((sw) => currentOf(ifaces, selected, sw, single)?.access ?? '');
    const v = merged((sw) => currentOf(ifaces, selected, sw, single)?.vlans ?? '');
    const u = merged((sw) => currentOf(ifaces, selected, sw, single)?.untagged ?? '');
    for (const [label, m] of [
      ['access', a],
      ['VLANs', v],
      ['untagged', u],
    ] as const) {
      if (m.kind === 'mixed') parts.push(`${label} ${m.groups.map((g) => `${g.value || '—'} ×${g.switches.length}`).join(', ')}`);
    }
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [single, holders, ifaces, selected]);

  function prefill(port: string, dom: string) {
    const sw = members.find((m) => currentOf(ifaces, dom, m, port));
    const cur = sw ? currentOf(ifaces, dom, sw, port) : undefined;
    if (cur?.access) {
      setMode('access');
      setAccess(cur.access);
      setVlans('');
      setUntagged('');
    } else if (cur && (cur.vlans || cur.untagged)) {
      setMode('trunk');
      setAccess('');
      setVlans(cur.vlans.replace(/\n/g, ', '));
      setUntagged(cur.untagged);
    }
  }

  function review() {
    const input: AttachInput = { mode, access: access.trim(), vlans, untagged: untagged.trim() };
    const current: Record<string, Record<string, ReturnType<typeof portAttachment>>> = Object.fromEntries(
      members.map((sw) => [
        sw,
        Object.fromEntries(picked.map((p) => [p, currentOf(ifaces, selected, sw, p)])),
      ]),
    );
    const exists: Record<string, Record<string, boolean>> = Object.fromEntries(
      members.map((sw) => [sw, Object.fromEntries(picked.map((p) => [p, !!ifaces[sw]?.[p]]))]),
    );
    const p = planAttachCalls(selected, members, picked, input, current, vid, exists);
    if (!p.ok) {
      setError(p.error);
      return;
    }
    setError(null);
    setPlan({ calls: p.calls, unchanged: p.unchanged });
  }

  const invalid =
    mode === 'access'
      ? invalidAttach({ mode, access, vlans: '', untagged: '' }, vid)
      : invalidAttach({ mode, access: '', vlans, untagged }, vid);
  const title = lockPorts ? `Bridge · ${ports[0] ?? ''}` : `Add ports · ${selected}`;
  const wide = group && plan ? true : false;

  return (
    <Modal open onClose={onClose} title={plan ? `${title} · review` : title} width={wide ? 600 : 460}>
      {plan ? (
        <ChangeFlow
          scope={scope}
          calls={plan.calls}
          unchanged={plan.unchanged}
          warning="Bridge membership changes forwarding on the switch."
          onBack={() => setPlan(null)}
          onClose={onClose}
          onApplied={() => {
            refreshInterfaces(queryClient);
            onApplied?.();
          }}
          notify={toast}
          doneText={`Bridge ports on ${selected}`}
        />
      ) : (
        <>
          {domains && (
            <LineDropdown
              label="Bridge domain"
              value={selected}
              onChange={(v) => {
                setSelected(v);
                if (single) prefill(single, v);
              }}
              options={domains.map((d) => ({ value: d, label: d }))}
            />
          )}
          {!lockPorts && (
            <InterfacePicker
              label="Ports"
              multiple
              options={options}
              members={members}
              value={picked}
              onChange={(v) => {
                setPicked(v);
                if (v.length === 1) prefill(v[0]!, selected);
              }}
            />
          )}
          {mixedNote && (
            <p role="status" style={{ fontSize: 13, color: 'var(--color-warn)', margin: '0 0 8px' }}>
              Differs across switches: {mixedNote} — saving aligns every member.
            </p>
          )}
          <LineDropdown
            label="Mode"
            value={mode}
            onChange={(v) => setMode(v as AttachMode)}
            options={[
              { value: 'access', label: 'Access (one VLAN, untagged)' },
              { value: 'trunk', label: 'Trunk (tagged VLAN list)' },
            ]}
          />
          {mode === 'access' ? (
            <LineField
              label="Access VLAN"
              value={access}
              inputMode="numeric"
              placeholder={`${vid.min}–${vid.max}`}
              onChange={(e) => setAccess(e.target.value)}
              error={access.trim() && invalid ? invalid : undefined}
            />
          ) : (
            <>
              <LineField
                label="VLANs"
                value={vlans}
                placeholder="comma-separated"
                onChange={(e) => setVlans(e.target.value)}
              />
              <LineField
                label="Untagged (native VLAN, optional)"
                value={untagged}
                inputMode="numeric"
                placeholder={`one of the VLANs · ${vid.min}–${vid.max}`}
                onChange={(e) => setUntagged(e.target.value)}
              />
            </>
          )}
          {error && <Alert tone="fail">{error}</Alert>}
          {invalid && (access.trim() || vlans.trim() || untagged.trim()) && (
            <Alert tone="fail">{invalid}</Alert>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <Button auto variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button auto onClick={review}>
              Review change
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Detach ports from a domain; the dry-run diff is the confirmation. */
export function DetachPorts({
  scope,
  domain,
  ports,
  members,
  ifaces,
  onClose,
  onApplied,
}: {
  scope: Scope;
  domain: string;
  ports: string[];
  /** Switches holding the attachment (detach targets). */
  members: string[];
  ifaces: Ifaces;
  onClose: () => void;
  onApplied?: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  useHeartbeat(members, `/bridge/domain/${domain}`);
  const attached = useMemo(
    () =>
      Object.fromEntries(
        members.map((sw) => [
          sw,
          Object.fromEntries(ports.map((p) => [p, !!currentOf(ifaces, domain, sw, p)])),
        ]),
      ),
    [members, ports, ifaces, domain],
  );
  const planned = useMemo(() => planDetachCalls(domain, members, ports, attached), [domain, members, ports, attached]);
  const title = `Detach ${ports.join(', ')} · ${domain}`;
  if (!planned.ok) {
    return (
      <Modal open onClose={onClose} title={title}>
        <Alert tone="warn">{planned.error}</Alert>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button auto variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} title={title} width={scope.kind === 'group' ? 600 : 460}>
      <ChangeFlow
        scope={scope}
        calls={planned.calls}
        unchanged={planned.unchanged}
        warning="Detaching stops bridge forwarding on these ports."
        onBack={onClose}
        onClose={onClose}
        onApplied={() => {
          refreshInterfaces(queryClient);
          onApplied?.();
        }}
        notify={toast}
        doneText={`Detach from ${domain}`}
      />
    </Modal>
  );
}
