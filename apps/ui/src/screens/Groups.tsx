/**
 * Groups: fan-out scopes, created here — independently of onboarding.
 * Each row enters a group home whose rail mirrors the switch menu, applied
 * to every member, with guardrails refusing per-switch-unique paths.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.js';
import type { GroupRow } from '../lib/api.js';
import { Alert, Button, Confirm, EmptyState, LineField, Modal, RowMenu, useToast } from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import type { TableColumns } from '../components/DataTable.js';
import { GlobalShell } from './GlobalShell.js';

const COLUMNS: TableColumns<GroupRow & { members: number }> = [
  { header: 'ID', accessorKey: 'id' },
  { header: 'Name', accessorFn: (r) => r.display_name || '—' },
  { header: 'Members', accessorFn: (r) => String(r.members) },
];

export function Groups() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [confirming, setConfirming] = useState<(GroupRow & { members: number }) | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.groups(), retry: false });
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  const create = useMutation({
    mutationFn: (id: string) => api.createGroup({ id, display_name: id }),
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      setCreatorOpen(false);
      setName('');
      setError(null);
      toast('pass', `Group ${group.id} created.`);
      navigate(`/groups/${group.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not create the group.'),
  });
  const rows = (groups.data ?? []).map((g) => ({
    ...g,
    members: (switches.data ?? []).filter((s) => s.groups.includes(g.id)).length,
  }));
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteGroup(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      toast('pass', `Group ${id} deleted.`);
    },
    onError: (err) => toast('fail', err instanceof ApiError ? err.message : 'Deletion failed.'),
  });
  const columns: TableColumns<GroupRow & { members: number }> = [
    ...COLUMNS,
    {
      header: '',
      id: 'actions',
      cell: ({ row }) => (
        <RowMenu
          label={`Actions for ${row.original.id}`}
          items={[
            { label: 'Open', onClick: () => navigate(`/groups/${row.original.id}`) },
            {
              label: 'Delete group',
              danger: true,
              disabled: row.original.members > 0,
              title:
                row.original.members > 0 ? `Unassign ${row.original.members} member(s) first` : undefined,
              onClick: () => setConfirming(row.original),
            },
          ]}
        />
      ),
    },
  ];
  const loading = groups.isPending || switches.isPending;
  return (
    <GlobalShell active="/groups">
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Groups</h1>
        <span style={{ flex: 1 }} />
        <span style={{ display: 'flex', gap: 8 }}>
          <Button auto variant="secondary" onClick={() => navigate('/switches/bulk')}>
            Bulk import
          </Button>
          <Button auto onClick={() => setCreatorOpen(true)}>
            New group
          </Button>
        </span>
      </div>
      {groups.isError && <Alert tone="fail">Could not load groups: {groups.error.message}</Alert>}
      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        empty={<EmptyState icon="switches" text="No groups yet." />}
        onRowClick={(row) => navigate(`/groups/${row.id}`)}
      />
      <Confirm
        open={confirming !== null}
        title={confirming ? `Delete group ${confirming.id}?` : 'Delete group?'}
        body="Members keep their switches; only the scope is deleted. Refused while switches still belong to it."
        confirmLabel="Delete group"
        danger
        busy={remove.isPending}
        onConfirm={() => {
          if (confirming) remove.mutate(confirming.id);
          setConfirming(null);
        }}
        onCancel={() => setConfirming(null)}
      />
      <Modal open={creatorOpen} onClose={() => setCreatorOpen(false)} title="New group">
        <LineField
          label="Group ID"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="dc1-leaf"
          error={error ?? undefined}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Button auto variant="secondary" onClick={() => setCreatorOpen(false)}>
            Cancel
          </Button>
          <Button
            auto
            disabled={create.isPending || name.trim().length === 0}
            onClick={() => name.trim() && create.mutate(name.trim())}
          >
            {create.isPending ? 'Creating…' : 'Create group'}
          </Button>
        </div>
      </Modal>
    </GlobalShell>
  );
}
