/**
 * Fleet dashboard: the welcome screen. Personal per user — Customize adds or
 * removes known widget ids (server catalog); widgets shipped later join once.
 * Every number comes from live endpoints through the shared widget library.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Alert, Button, Hint, Modal } from '../components/ui.js';
import { GlobalShell } from './GlobalShell.js';
import { WIDGETS, WidgetGrid } from './dashboard/widgets.js';

export function FleetDashboard() {
  const queryClient = useQueryClient();
  const [customizing, setCustomizing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  const prefs = useQuery({ queryKey: ['dashboard-prefs'], queryFn: () => api.dashboard(), retry: false });
  const save = useMutation({
    mutationFn: (widgets: Array<{ id: string }>) => api.saveDashboard(widgets),
    onSuccess: (data) => queryClient.setQueryData(['dashboard-prefs'], data),
  });
  const ids = (prefs.data?.widgets ?? []).map((w) => w.id).filter((id) => WIDGETS[id]);
  const missing = Object.keys(WIDGETS).filter((id) => !ids.includes(id));
  const missingEntries = missing.flatMap((id) => {
    const entry = WIDGETS[id];
    return entry ? [{ id, ...entry }] : [];
  });

  function setIds(next: string[]) {
    save.mutate(next.map((id) => ({ id })));
  }

  return (
    <GlobalShell active="/dashboard">
      <div className="list-head" style={{ gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
            Dashboard
            <Hint text="Every workload, at a glance. Personal to you — Customize to add or remove widgets." />
          </h1>
        </div>
        <span style={{ flex: 1 }} />
        <Button auto variant="secondary" onClick={() => setCustomizing((c) => !c)}>
          {customizing ? 'Done' : 'Customize'}
        </Button>
      </div>
      {switches.isError && <Alert tone="fail">Could not load switches: {switches.error.message}</Alert>}
      {switches.data && (
        <WidgetGrid
          ids={ids}
          switches={switches.data}
          fleet
          onRemove={customizing && ids.length > 1 ? (id) => setIds(ids.filter((x) => x !== id)) : undefined}
        />
      )}
      {customizing && missing.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Button auto variant="secondary" onClick={() => setPickerOpen(true)}>
            Add widget
          </Button>
        </div>
      )}
      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} title="Add widget">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {missingEntries.map(({ id, title, blurb }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => {
                  setIds([...ids, id]);
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
                <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
                <br />
                <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>{blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </GlobalShell>
  );
}
