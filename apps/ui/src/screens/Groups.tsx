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
import {
  Alert,
  Button,
  Confirm,
  EmptyState,
  LineField,
  Modal,
  PromptModal,
  useToast,
} from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import type { GridColumn } from '../components/DataTable.js';
import { GlobalShell } from './GlobalShell.js';

const COLUMNS: GridColumn<GroupRow & { members: number }>[] = [
  { key: 'id', label: 'ID', always: true, value: (r) => r.id },
  { key: 'name', label: 'Name', value: (r) => r.display_name || '—' },
  { key: 'members', label: 'Members', value: (r) => String(r.members) },
];

export function Groups() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [confirming, setConfirming] = useState<(GroupRow & { members: number }) | null>(null);
  const [renaming, setRenaming] = useState<GroupRow | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
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
  const rename = useMutation({
    mutationFn: ({ id, display_name }: { id: string; display_name: string }) =>
      api.renameGroup(id, display_name),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] });
      toast('pass', `Group ${vars.id} renamed.`);
      setRenaming(null);
      setRenameError(null);
    },
    onError: (err) => setRenameError(err instanceof ApiError ? err.message : 'Rename failed.'),
  });
  const rowMenu = (row: GroupRow & { members: number }) => [
    { label: 'Open', onClick: () => navigate(`/groups/${row.id}`) },
    {
      label: 'Rename',
      onClick: () => {
        setRenameError(null);
        setRenaming(row);
      },
    },
    {
      label: 'Delete group',
      danger: true,
      disabled: row.members > 0,
      title: row.members > 0 ? `Unassign ${row.members} member(s) first` : undefined,
      onClick: () => setConfirming(row),
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
        cols={COLUMNS}
        rows={rows}
        loading={loading}
        empty={<EmptyState icon="switches" text="No groups yet." />}
        storageKey="cumulus.groups.v1"
        onRowClick={(row) => navigate(`/groups/${row.id}`)}
        actions={rowMenu}
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
      <PromptModal
        open={renaming !== null}
        title={renaming ? `Rename ${renaming.id}` : 'Rename group'}
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
