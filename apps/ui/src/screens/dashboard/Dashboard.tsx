/**
 * Dashboard: one personal, customizable widget board for every scope — the
 * fleet welcome screen, a group overview, a switch home. The layout is saved
 * per user per scope on the server, which also says which widgets a scope
 * may show. Customize: drag or arrow-move cards, remove them, add ones not
 * on screen, or reset to the default layout. Changes save as they happen.
 */
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type DashboardPrefs, type DashboardScope, type SwitchRow } from '../../lib/api.js';
import { Alert, Button, Hint, Modal, Spinner, useToast } from '../../components/ui.js';
import { WIDGETS, WidgetGrid } from './widgets.js';

export function Dashboard({
  scope,
  switches,
  groupId,
  title,
  hint,
  actions,
  children,
}: {
  scope: DashboardScope;
  switches: SwitchRow[];
  groupId?: string;
  title: ReactNode;
  hint: string;
  /** Scope buttons beside Customize (e.g. Add devices). */
  actions?: ReactNode;
  /** Banners between the header and the grid (trust, read errors). */
  children?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const key = ['dashboard-prefs', scope];
  const prefs = useQuery({ queryKey: key, queryFn: () => api.dashboard(scope), retry: false });
  const save = useMutation({
    mutationFn: (ids: string[]) =>
      api.saveDashboard(
        scope,
        ids.map((id) => ({ id })),
      ),
    // Optimistic: the grid moves under the pointer, the server confirms.
    onMutate: (ids) => {
      const prev = queryClient.getQueryData<DashboardPrefs>(key);
      if (prev)
        queryClient.setQueryData<DashboardPrefs>(key, { ...prev, widgets: ids.map((id) => ({ id })) });
      return { prev };
    },
    onSuccess: (data) => queryClient.setQueryData(key, data),
    onError: (err, _ids, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(key, ctx.prev);
      toast('fail', err instanceof ApiError ? err.message : 'Could not save the layout.');
    },
  });
  const ids = (prefs.data?.widgets ?? []).map((w) => w.id).filter((id) => WIDGETS[id]);
  const addable = (prefs.data?.available ?? []).filter((id) => WIDGETS[id] && !ids.includes(id));

  return (
    <>
      <div className="list-head" style={{ gap: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
          {title}
          <Hint text={`${hint} Personal to you — Customize to rearrange, add or remove widgets.`} />
        </h1>
        <span style={{ flex: 1 }} />
        {!editing && actions}
        {editing && (
          <>
            <Button auto variant="secondary" disabled={save.isPending} onClick={() => save.mutate([])}>
              Reset to default
            </Button>
            <Button
              auto
              variant="secondary"
              disabled={addable.length === 0}
              onClick={() => setPickerOpen(true)}
            >
              Add widget
            </Button>
          </>
        )}
        <Button auto variant={editing ? 'primary' : 'secondary'} onClick={() => setEditing((e) => !e)}>
          {editing ? 'Done' : 'Customize'}
        </Button>
      </div>
      {children}
      {editing && (
        <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '0 0 12px' }}>
          Drag a card to move it, or use its arrows. Changes save as you go.
        </p>
      )}
      {prefs.isError ? (
        <Alert tone="fail">Could not load your layout: {prefs.error.message}</Alert>
      ) : prefs.isPending ? (
        <Spinner label="Loading dashboard" />
      ) : (
        <WidgetGrid
          ids={ids}
          switches={switches}
          fleet={scope === 'fleet'}
          groupId={groupId}
          onChange={editing ? (next) => save.mutate(next) : undefined}
        />
      )}
      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add widget">
        {addable.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Every widget is already on.</p>
        ) : (
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: 8,
              maxHeight: '60vh',
              overflowY: 'auto',
            }}
          >
            {addable.map((id) => {
              const w = WIDGETS[id];
              if (!w) return null;
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => {
                      save.mutate([...ids, id]);
                      setPickerOpen(false);
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 8,
                      color: 'var(--color-text)',
                      cursor: 'pointer',
                      font: 'inherit',
                      padding: '10px 12px',
                    }}
                  >
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{w.title}</span>
                    <br />
                    <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>{w.blurb}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
    </>
  );
}
