/**
 * Group home: the switch menu scoped to every member. Empty groups get a
 * centered icon + Add devices action (no warning colors for a normal state).
 * Guardrail detail lives behind the title Hint; leftover prose stays out.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.js';
import {
  Alert,
  AppShell,
  Button,
  EmptyState,
  Hint,
  Modal,
  NavRail,
  usePinnedRail,
  useToast,
} from '../components/ui.js';
import { groupNav } from '../lib/nav.js';

const UNIQUE_EXAMPLES = 'interface IPs, MAC addresses, BGP router-ids, hostnames';

export function GroupHome() {
  const { groupId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [collapsed, toggleCollapsed] = usePinnedRail('scope');
  const [adderOpen, setAdderOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  const members = (switches.data ?? []).filter((s) => s.groups.includes(groupId));
  const save = useMutation({
    mutationFn: async (ids: string[]) => {
      const all = switches.data ?? [];
      await Promise.all(
        ids.map((id) => {
          const current = all.find((s) => s.id === id)?.groups ?? [];
          if (current.includes(groupId)) return Promise.resolve();
          return api.setSwitchGroups(id, [...current, groupId]);
        }),
      );
    },
    onSuccess: (_d, ids) => {
      queryClient.invalidateQueries({ queryKey: ['switches'] });
      toast('pass', `${ids.length} device(s) added to ${groupId}.`);
      setAdderOpen(false);
    },
    onError: (err) => toast('fail', err instanceof ApiError ? err.message : 'Could not add devices.'),
  });
  async function logout() {
    await api.logout();
    navigate('/login', { replace: true });
  }
  function openAdder() {
    setPicked(members.map((m) => m.id));
    setAdderOpen(true);
  }
  const candidates = switches.data ?? [];
  return (
    <AppShell
      rail={
        <NavRail
          brand={false}
          back={{ label: 'Groups', to: '/groups' }}
          scope={{
            kind: 'group',
            name: groupId,
            sub: `${members.length} member${members.length === 1 ? '' : 's'}`,
          }}
          items={groupNav(groupId)}
          active={`/groups/${groupId}`}
          onNav={navigate}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
        />
      }
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 16px' }}>
        {groupId}
        <Hint
          text={`Group scope: one change fans out to every member. Group-safe paths (NTP, DNS, syslog, VLANs) apply everywhere. Per-switch-unique paths (${UNIQUE_EXAMPLES}) are refused here, change those per switch.`}
        />
      </h1>
      {switches.isError && <Alert tone="fail">Could not load switches: {switches.error.message}</Alert>}
      {!switches.isPending && members.length === 0 && (
        <EmptyState
          icon="switches"
          text="No devices added to this group yet."
          action={
            <Button auto onClick={openAdder}>
              Add devices
            </Button>
          }
        />
      )}
      {members.length > 0 && (
        <>
          <div style={{ marginBottom: 12 }}>
            <Button auto variant="secondary" onClick={openAdder}>
              Add devices
            </Button>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {members.map((m) => (
              <li key={m.id} style={{ fontSize: 15 }}>
                <button
                  type="button"
                  onClick={() => navigate(`/switches/${m.id}`)}
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
                  {m.display_name || m.id}
                </button>{' '}
                <span style={{ color: 'var(--color-muted)', fontSize: 14 }}>
                  {m.trust_verified ? '' : 'trust pending'}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Modal open={adderOpen} onClose={() => setAdderOpen(false)} title={`Add devices to ${groupId}`}>
        {candidates.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>
            No switches onboarded yet. Onboard one first, then add it here.
          </p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: 4,
              maxHeight: 320,
              overflow: 'auto',
            }}
          >
            {candidates.map((s) => (
              <li key={s.id}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    fontSize: 14,
                    padding: '8px 4px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={picked.includes(s.id)}
                    onChange={() =>
                      setPicked((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))
                    }
                  />
                  {s.display_name || s.id}
                  {s.groups.includes(groupId) && (
                    <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>member</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button auto variant="secondary" onClick={() => setAdderOpen(false)}>
            Cancel
          </Button>
          <Button auto disabled={save.isPending || picked.length === 0} onClick={() => save.mutate(picked)}>
            {save.isPending ? 'Adding…' : `Add ${picked.length} device${picked.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </Modal>
    </AppShell>
  );
}
