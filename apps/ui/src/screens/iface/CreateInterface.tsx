/**
 * New interface (3A.6 BondBuilder + sub-interfaces) and delete, in either
 * scope. A group creates the same name on every member that lacks it;
 * members that already have it are left alone. Writes ride ChangeFlow, so
 * the dry-run diff is the confirmation (service-affecting, roadmap §6.6).
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type StageCall } from '../../lib/api.js';
import {
  Alert,
  Button,
  LineDropdown,
  LineField,
  Modal,
  Spinner,
  Tabs,
  useToast,
} from '../../components/ui.js';
import { boundsOf, choicesOf, leafSchema, setEntries } from '../../lib/fieldSchema.js';
import { ChangeFlow } from './ChangeFlow.js';
import { refreshInterfaces, type Scope } from './scope.js';

/** Linux interface names: ≤15 chars, no spaces or slashes. */
const IFNAME = /^[A-Za-z][A-Za-z0-9_.-]{0,14}$/;

export function CreateInterface({
  scope,
  members,
  existing,
  ports,
  onClose,
}: {
  scope: Scope;
  members: string[];
  /** Interface names present per member. */
  existing: Record<string, string[]>;
  /** Candidate bond members / sub-interface parents (swp, bond), union across members. */
  ports: string[];
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'bond' | 'sub'>('bond');
  const [name, setName] = useState('');
  const [bondMembers, setBondMembers] = useState('');
  const [mode, setMode] = useState('');
  const [parent, setParent] = useState('');
  const [vlan, setVlan] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<{
    calls: Record<string, StageCall[]>;
    unchanged: string[];
    name: string;
  } | null>(null);
  const root = useQuery({
    queryKey: ['spec-fields', 'interface', ''],
    queryFn: () => api.fields('/interface/x', 'PATCH'),
    staleTime: Infinity,
  });
  const bond = useQuery({
    queryKey: ['spec-fields', 'interface', 'bond'],
    queryFn: () => api.fields('/interface/x/bond', 'PATCH'),
    staleTime: Infinity,
  });
  const modes = choicesOf(leafSchema(bond.data?.schema, 'mode'));
  const vlanBounds = boundsOf(leafSchema(root.data?.schema, 'vlan'));

  function review() {
    let ifname: string;
    let body: Record<string, unknown>;
    if (kind === 'bond') {
      ifname = name.trim();
      const list = setEntries(bondMembers);
      if (!IFNAME.test(ifname)) return setError('Name: letters, digits, . _ - only, up to 15 characters.');
      if (list.length === 0) return setError('Add at least one member port.');
      body = {
        type: 'bond',
        bond: { member: Object.fromEntries(list.map((m) => [m, {}])), ...(mode ? { mode } : {}) },
      };
    } else {
      const n = Number(vlan);
      const { min = 1, max = 4094 } = vlanBounds;
      if (!parent) return setError('Pick the parent port.');
      if (!Number.isInteger(n) || n < min || n > max)
        return setError(`VLAN must be a whole number from ${min} to ${max}.`);
      ifname = `${parent}.${n}`;
      if (!IFNAME.test(ifname)) return setError(`${ifname} is longer than 15 characters.`);
      body = { type: 'sub', 'base-interface': parent, vlan: n };
    }
    const calls: Record<string, StageCall[]> = {};
    const unchanged: string[] = [];
    for (const sw of members) {
      if (existing[sw]?.includes(ifname)) unchanged.push(sw);
      else calls[sw] = [{ path: `/interface/${ifname}`, method: 'PATCH', body }];
    }
    if (Object.keys(calls).length === 0) return setError(`${ifname} already exists everywhere here.`);
    setError(null);
    setPlan({ calls, unchanged, name: ifname });
  }

  const loading = root.isPending || bond.isPending;
  return (
    <Modal
      open
      onClose={onClose}
      title={plan ? `New ${plan.name}` : 'New interface'}
      width={scope.kind === 'group' && plan ? 600 : 460}
    >
      {loading ? (
        <Spinner label="Loading options" />
      ) : plan ? (
        <ChangeFlow
          scope={scope}
          calls={plan.calls}
          unchanged={plan.unchanged}
          warning="Creating an interface changes forwarding on the switch."
          onBack={() => setPlan(null)}
          onClose={onClose}
          onApplied={() => refreshInterfaces(queryClient)}
          notify={toast}
          doneText={`New ${plan.name}`}
        />
      ) : (
        <>
          <Tabs
            tabs={[
              { id: 'bond', label: 'Bond' },
              { id: 'sub', label: 'Sub-interface' },
            ]}
            active={kind}
            onChange={(id) => {
              setKind(id as 'bond' | 'sub');
              setError(null);
            }}
          />
          {kind === 'bond' ? (
            <>
              <LineField
                label="Name"
                value={name}
                placeholder="bond1"
                onChange={(e) => setName(e.target.value)}
              />
              <LineField
                label="Member ports"
                value={bondMembers}
                placeholder={ports.slice(0, 2).join(', ') || 'swp1, swp2'}
                onChange={(e) => setBondMembers(e.target.value)}
              />
              <LineDropdown
                label="Mode"
                value={mode}
                onChange={setMode}
                options={[{ value: '', label: 'Default' }, ...modes.map((m) => ({ value: m, label: m }))]}
              />
            </>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 20 }}>
              <LineDropdown
                label="Parent port"
                value={parent}
                onChange={setParent}
                options={[{ value: '', label: '—' }, ...ports.map((p) => ({ value: p, label: p }))]}
              />
              <LineField
                label="VLAN"
                value={vlan}
                inputMode="numeric"
                placeholder={`${vlanBounds.min ?? 1}–${vlanBounds.max ?? 4094}`}
                onChange={(e) => setVlan(e.target.value)}
              />
            </div>
          )}
          {error && <Alert tone="fail">{error}</Alert>}
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

/** Delete one interface on the members that have it; the dry-run is the confirmation. */
export function DeleteInterface({
  scope,
  ifname,
  members,
  onClose,
}: {
  scope: Scope;
  ifname: string;
  members: string[];
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const calls = Object.fromEntries(
    members.map((sw) => [sw, [{ path: `/interface/${ifname}`, method: 'DELETE' as const }]]),
  );
  return (
    <Modal open onClose={onClose} title={`Delete ${ifname}`} width={scope.kind === 'group' ? 600 : 460}>
      <ChangeFlow
        scope={scope}
        calls={calls}
        warning={`Deleting ${ifname} removes it and its configuration; traffic on it stops.`}
        onBack={onClose}
        onClose={onClose}
        onApplied={() => refreshInterfaces(queryClient)}
        notify={toast}
        doneText={`Delete ${ifname}`}
      />
    </Modal>
  );
}
