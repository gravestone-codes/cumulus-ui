/**
 * Switches: fleet inventory. Platform data (not NVUE), so a plain DataTable
 * over /api/v1/inventory/switches — rows enter their switch-scoped rail.
 */
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { SwitchRow } from '../lib/api.js';
import { Alert, Button } from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import type { TableColumns } from '../components/DataTable.js';
import { GlobalShell } from './GlobalShell.js';

const COLUMNS: TableColumns<SwitchRow> = [
  { header: 'ID', accessorKey: 'id' },
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
];

export function Switches() {
  const navigate = useNavigate();
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
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
        columns={COLUMNS}
        rows={switches.data ?? []}
        loading={switches.isPending}
        onRowClick={(row) => navigate(`/switches/${row.id}`)}
      />
    </GlobalShell>
  );
}
