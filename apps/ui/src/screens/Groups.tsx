/**
 * Groups: fan-out scopes. Each row enters a group home whose rail mirrors
 * the switch menu — same items, applied to every member, with guardrails
 * refusing per-switch-unique paths (IPs, MACs, router-ids) group-wide.
 */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { GroupRow } from '../lib/api.js';
import { Alert, Button } from '../components/ui.js';
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
  const groups = useQuery({ queryKey: ['groups'], queryFn: () => api.groups(), retry: false });
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  const rows = (groups.data ?? []).map((g) => ({
    ...g,
    members: (switches.data ?? []).filter((s) => s.groups.includes(g.id)).length,
  }));
  const loading = groups.isPending || switches.isPending;
  return (
    <GlobalShell active="/groups">
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Groups</h1>
        <span style={{ flex: 1 }} />
        <Button auto variant="secondary" onClick={() => navigate('/switches/bulk')}>
          Bulk import
        </Button>
      </div>
      {groups.isError && <Alert tone="fail">Could not load groups: {groups.error.message}</Alert>}
      <DataTable
        columns={COLUMNS}
        rows={rows}
        loading={loading}
        onRowClick={(row) => navigate(`/groups/${row.id}`)}
      />
      <p style={{ fontSize: 14, color: 'var(--color-muted)', marginTop: 12 }}>
        Groups are created during switch onboarding. Opening one shows the switch menu scoped to all its
        members.
      </p>
    </GlobalShell>
  );
}
