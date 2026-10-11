/**
 * App shell for interface screens in either scope: the switch rail or the
 * group rail, same pages inside. Keeps scope wiring out of every screen —
 * including the "changed outside the app" (4.6) and active-branch (1.2) banners.
 */
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type DraftSummary, type Drift } from '../../lib/api.js';
import { Alert, AppShell, Button, Confirm, NavRail, usePinnedRail, useToast } from '../../components/ui.js';
import { groupNav, switchNav } from '../../lib/nav.js';
import { scopeBase, type Scope } from './scope.js';

export function ScopeShell({
  scope,
  active,
  children,
}: {
  scope: Scope;
  active: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const [collapsed, toggleCollapsed] = usePinnedRail('scope');
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  async function logout() {
    await api.logout();
    navigate('/login', { replace: true });
  }
  const group = scope.kind === 'group';
  return (
    <AppShell
      rail={
        <NavRail
          brand={false}
          back={group ? { label: 'Groups', to: '/groups' } : { label: 'Switches', to: '/switches' }}
          scope={{ kind: scope.kind, name: scope.id }}
          items={group ? groupNav(scope.id) : switchNav(scope.id)}
          active={`${scopeBase(scope)}${active}`}
          onNav={navigate}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
        />
      }
    >
      <ChangedBanner scope={scope} />
      <BranchBanner scope={scope} />
      {children}
    </AppShell>
  );
}

/** How often screens re-ask; the backend polls switches on its own (group) interval. */
const DRIFT_REFETCH_MS = 15_000;

/**
 * Refresh after an out-of-band change: mark the switches seen, then refetch
 * every cached read — the only time full state is re-pulled for the move.
 */
export function useRefreshSwitches(): (switches: string[]) => Promise<void> {
  const queryClient = useQueryClient();
  return async (switches) => {
    await Promise.all(switches.map((sw) => api.ackDrift(sw)));
    await queryClient.invalidateQueries();
  };
}

/** "Switch changed outside the app" for the switches in scope; refresh is required before editing. */
export function ChangedBanner({ scope }: { scope: Scope }) {
  const refresh = useRefreshSwitches();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ['drift'],
    queryFn: () => api.drifts(),
    refetchInterval: DRIFT_REFETCH_MS,
  });
  const hits = (q.data ?? []).filter((d) =>
    scope.kind === 'switch' ? d.switchId === scope.id : (d.groups ?? []).includes(scope.id),
  );
  if (hits.length === 0) return null;
  async function onRefresh() {
    setBusy(true);
    try {
      await refresh(hits.map((d) => d.switchId));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <Alert tone="warn">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            {hits.map((d) => (
              <div key={d.switchId}>
                <strong>{d.switchId}</strong> changed outside the app{driftBy(d)}.
              </div>
            ))}
            <div style={{ color: 'var(--color-muted)', fontSize: 13, marginTop: 4 }}>
              What you see may be out of date. Refresh before editing.
            </div>
          </div>
          <Button auto variant="secondary" onClick={() => void onRefresh()} disabled={busy}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </Alert>
    </div>
  );
}

/** " · CLI by root at 2026-10-08 14:58" from NVUE's attribution, when present. */
export function driftBy(d: Drift): string {
  const by = d.by;
  if (!by) return '';
  const who = [by.type, by.user ? `by ${by.user}` : null].filter(Boolean).join(' ');
  return [who && ` · ${who}`, by.date && ` at ${by.date}`].filter(Boolean).join('');
}

/** How often the branch banner re-asks; branches change only through stage/apply/discard. */
const DRAFT_REFETCH_MS = 15_000;

/** "3h ago" from an ISO timestamp; "just now" under a minute. */
export function draftAge(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** Active staging branch(es) in scope (roadmap 1.2): visible on every screen, discard with confirm. */
export function BranchBanner({ scope }: { scope: Scope }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<DraftSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const drafts = useQuery({
    queryKey: ['drafts'],
    queryFn: () => api.myDrafts(),
    refetchInterval: DRAFT_REFETCH_MS,
  });
  const group = scope.kind === 'group';
  const switches = useQuery({
    queryKey: ['switches'],
    queryFn: () => api.switches(),
    retry: false,
    enabled: group,
  });
  if (drafts.isPending || drafts.isError) return null;
  if (group && switches.isPending) return null;
  const members = group ? new Set((switches.data ?? []).filter((s) => s.groups.includes(scope.id)).map((s) => s.id)) : null;
  const hits = (drafts.data ?? []).filter((d) =>
    scope.kind === 'switch' ? d.switchId === scope.id : members?.has(d.switchId),
  );
  if (hits.length === 0) return null;

  async function onDiscard() {
    if (!pending) return;
    setBusy(true);
    try {
      await api.discardBranch(pending.switchId);
      await queryClient.invalidateQueries({ queryKey: ['drafts'] });
      toast('warn', `Discarded staged changes on ${pending.switchId}.`);
      setPending(null);
    } catch (err) {
      toast('fail', err instanceof ApiError || err instanceof Error ? err.message : 'Discard failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <Alert tone="note">
        {hits.map((d) => (
          <div key={d.switchId} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <strong>{d.switchId}</strong> · staging on branch <span className="mono">{d.branch}</span>
              {' · '}
              {d.stagedCount === 0
                ? 'open, nothing staged yet'
                : `${d.stagedCount} change${d.stagedCount === 1 ? '' : 's'} staged`}
              {draftAge(d.basedAt) && ` · based ${draftAge(d.basedAt)}`}
            </div>
            <Button auto variant="secondary" onClick={() => setPending(d)}>
              Discard
            </Button>
          </div>
        ))}
        <div style={{ color: 'var(--color-muted)', fontSize: 13, marginTop: 4 }}>
          Unapplied work survives logout. Discarding is explicit and immediate.
        </div>
      </Alert>
      <Confirm
        open={pending !== null}
        title={`Discard staged changes on ${pending?.switchId ?? ''}?`}
        body={
          pending && pending.stagedCount > 0
            ? `${pending.stagedCount} staged change${pending.stagedCount === 1 ? '' : 's'} on branch ${pending.branch} will be dropped. This cannot be undone.`
            : `Open branch ${pending?.branch ?? ''} will be dropped. This cannot be undone.`
        }
        confirmLabel="Discard"
        onConfirm={() => void onDiscard()}
        onCancel={() => (busy ? undefined : setPending(null))}
        busy={busy}
      />
    </div>
  );
}
