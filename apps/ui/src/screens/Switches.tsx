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
import { Alert, Button, Confirm, EmptyState, RowMenu, useToast } from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import type { TableColumns } from '../components/DataTable.js';
import { GlobalShell } from './GlobalShell.js';

export function Switches() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState<SwitchRow | null>(null);
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteSwitch(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['switches'] });
      toast('pass', `Switch ${id} removed.`);
    },
    onError: (err) => toast('fail', err instanceof ApiError ? err.message : 'Removal failed.'),
  });

  const columns: TableColumns<SwitchRow> = [
    { header: 'Hostname', accessorKey: 'id' },
    { header: 'Name', accessorFn: (r) => r.display_name || '—' },
    { header: 'Groups', accessorFn: (r) => (r.groups.length > 0 ? r.groups.join(', ') : '—') },
    {
      header: 'Trust',
      accessorFn: (r) => (r.trust_verified ? 'Verified' : 'Pending'),
    },
    {
      header: 'Reachable',
      accessorFn: (r) => (r.last_check_ok === true ? 'Yes' : r.last_check_ok === false ? 'No' : 'Unknown'),
    },
    { header: 'Last seen', accessorFn: (r) => r.last_seen_at ?? '—' },
    {
      header: '',
      id: 'actions',
      cell: ({ row }) => (
        <RowMenu
          label={`Actions for ${row.original.id}`}
          items={[
            { label: 'Open', onClick: () => navigate(`/switches/${row.original.id}`) },
            { label: 'Remove switch', danger: true, onClick: () => setConfirming(row.original) },
          ]}
        />
      ),
    },
  ];

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
        columns={columns}
        rows={switches.data ?? []}
        loading={switches.isPending}
        empty={<EmptyState icon="switches" text="No switches added yet." />}
        onRowClick={(row) => navigate(`/switches/${row.id}`)}
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
    </GlobalShell>
  );
}
