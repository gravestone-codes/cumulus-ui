/**
 * Switches: fleet inventory. Platform data (not NVUE), so a plain DataTable
 * over /api/v1/inventory/switches — rows enter their switch-scoped rail.
 * Row controls (GRG RowMenu contract): Open, Remove switch (confirmed).
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.js';
import type { SwitchRow } from '../lib/api.js';
import { Alert, Button, Confirm, EmptyState, PromptModal, useToast } from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import type { GridColumn } from '../components/DataTable.js';
import { timeAgo } from '../lib/format.js';
import { GlobalShell } from './GlobalShell.js';

export function Switches() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState<SwitchRow | null>(null);
  const [renaming, setRenaming] = useState<SwitchRow | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  const rename = useMutation({
    mutationFn: ({ id, display_name }: { id: string; display_name: string }) =>
      api.renameSwitch(id, display_name),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['switches'] });
      toast('pass', `Switch ${vars.id} renamed.`);
      setRenaming(null);
      setRenameError(null);
    },
    onError: (err) => setRenameError(err instanceof ApiError ? err.message : 'Rename failed.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSwitch(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['switches'] });
      toast('pass', `Switch ${id} removed.`);
    },
    onError: (err) => toast('fail', err instanceof ApiError ? err.message : 'Removal failed.'),
  });

  const columns: GridColumn<SwitchRow>[] = [
    { key: 'id', label: 'Hostname', always: true, value: (r) => r.id },
    { key: 'name', label: 'Name', value: (r) => r.display_name || '—' },
    { key: 'groups', label: 'Groups', value: (r) => (r.groups.length > 0 ? r.groups.join(', ') : '—') },
    { key: 'trust', label: 'Trust', value: (r) => (r.trust_verified ? 'Verified' : 'Pending') },
    {
      key: 'reachable',
      label: 'Reachable',
      value: (r) => (r.last_check_ok === true ? 'Yes' : r.last_check_ok === false ? 'No' : 'Unknown'),
    },
    { key: 'seen', label: 'Last seen', value: (r) => timeAgo(r.last_seen_at) },
  ];

  function rowMenu(row: SwitchRow) {
    return [
      { label: 'Open', onClick: () => navigate(`/switches/${row.id}`) },
      {
        label: 'Rename',
        onClick: () => {
          setRenameError(null);
          setRenaming(row);
        },
      },
      { label: 'Remove switch', danger: true, onClick: () => setConfirming(row) },
    ];
  }

  return (
    <GlobalShell active="/switches">
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Switches</h1>
        <span style={{ flex: 1 }} />
        <span style={{ display: 'flex', gap: 8 }}>
          <Button auto variant="secondary" onClick={() => navigate('/switches/bulk')}>
            Bulk import
          </Button>
          <Button auto onClick={() => navigate('/switches/new')}>
            Onboard a switch
          </Button>
        </span>
      </div>
      {switches.isError && <Alert tone="fail">Could not load switches: {switches.error.message}</Alert>}
      <DataTable
        cols={columns}
        rows={switches.data ?? []}
        loading={switches.isPending}
        empty={<EmptyState icon="switches" text="No switches added yet." />}
        storageKey="cumulus.switches.v1"
        onRowClick={(row) => navigate(`/switches/${row.id}`)}
        actions={rowMenu}
      />
      <Confirm
        open={confirming !== null}
        title={confirming ? `Remove ${confirming.id}?` : 'Remove switch?'}
        body="Fully destructive in Junction: inventory entry, sealed credentials, staged branches and presence are deleted. Audit history is kept. The switch itself is untouched."
        confirmLabel="Remove switch"
        danger
        busy={remove.isPending}
        onConfirm={() => {
          if (confirming) remove.mutate(confirming.id);
          setConfirming(null);
        }}
        onCancel={() => setConfirming(null)}
      />
      <PromptModal
        open={renaming !== null}
        title={renaming ? `Rename ${renaming.id}` : 'Rename switch'}
        label="Display name"
        initial={renaming?.display_name ?? ''}
        confirmLabel="Rename"
        busy={rename.isPending}
        error={renameError}
        onSubmit={(value) => renaming && rename.mutate({ id: renaming.id, display_name: value })}
        onCancel={() => {
          setRenaming(null);
          setRenameError(null);
        }}
      />
    </GlobalShell>
  );
}
