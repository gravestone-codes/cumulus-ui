/**
 * Switch home: landing for a chosen switch inside the app shell.
 * Unfinished onboarding resumes from here; removal lives here too (danger
 * zone, confirmed, fully destructive in-app: inventory, credentials,
 * staged branches and presence die, audit history stays).
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.js';
import { Alert, AppShell, Button, Confirm, NavRail, usePinnedRail, useToast } from '../components/ui.js';
import { switchNav } from '../lib/nav.js';

export function SwitchHome() {
  const { switchId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [collapsed, toggleCollapsed] = usePinnedRail('scope');
  const [confirming, setConfirming] = useState(false);
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  const row = (switches.data ?? []).find((s) => s.id === switchId);
  const remove = useMutation({
    mutationFn: () => api.deleteSwitch(switchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['switches'] });
      toast('pass', `Switch ${switchId} removed.`);
      navigate('/switches', { replace: true });
    },
    onError: (err) => toast('fail', err instanceof ApiError ? err.message : 'Removal failed.'),
  });
  async function logout() {
    await api.logout();
    navigate('/login', { replace: true });
  }
  return (
    <AppShell
      rail={
        <NavRail
          brand={false}
          back={{ label: 'Switches', to: '/switches' }}
          scope={{ kind: 'switch', name: switchId }}
          items={switchNav(switchId)}
          active={`/switches/${switchId}`}
          onNav={navigate}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
        />
      }
    >
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>{switchId}</h1>
      <p style={{ color: 'var(--color-muted)', fontSize: 14, margin: '0 0 20px' }}>
        Pick a domain. Every value on these screens is read live from the switch.
      </p>
      {row && !row.trust_verified && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="warn">
            Onboarding unfinished: this switch is not trusted yet.{' '}
            <button
              type="button"
              onClick={() => navigate(`/switches/new?resume=${encodeURIComponent(switchId)}`)}
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
              Finish onboarding
            </button>
          </Alert>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button auto onClick={() => navigate(`/switches/${switchId}/interfaces`)}>
          Interfaces
        </Button>
      </div>
      <div style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-fail)', margin: '0 0 8px' }}>
          Danger zone
        </h2>
        <Button auto variant="danger" onClick={() => setConfirming(true)}>
          Remove switch
        </Button>
      </div>
      <Confirm
        open={confirming}
        title={`Remove ${switchId}?`}
        body="Fully destructive in Junction: inventory entry, sealed credentials, staged branches and presence are deleted. Audit history is kept. The switch itself is untouched."
        confirmLabel="Remove switch"
        danger
        busy={remove.isPending}
        onConfirm={() => {
          setConfirming(false);
          remove.mutate();
        }}
        onCancel={() => setConfirming(false)}
      />
    </AppShell>
  );
}
