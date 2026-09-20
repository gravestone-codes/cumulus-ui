/**
 * Interfaces proof slice (3A.1–3A.7, read half): the first thin domain over
 * the generic ResourceList. Column choice is presentation; every value comes
 * from the query proxy. Edit (description/MTU/speed) lands with ResourceForm.
 */
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { AppShell, NavRail } from '../components/ui.js';
import { ResourceList } from '../components/resource.js';
import type { TableColumns } from '../components/DataTable.js';
import { switchNav } from '../lib/nav.js';

type IfaceRow = Record<string, unknown> & { __id: string };

const COLUMNS: TableColumns<IfaceRow> = [
  { header: 'Name', accessorKey: '__id' },
  { header: 'State', accessorFn: (r) => String(r['state'] ?? '—') },
  { header: 'Speed', accessorFn: (r) => String(r['speed'] ?? '—') },
  { header: 'MTU', accessorFn: (r) => String(r['mtu'] ?? '—') },
  { header: 'Description', accessorFn: (r) => String(r['description'] ?? '—') },
];

export function Interfaces() {
  const { switchId = '' } = useParams();
  const navigate = useNavigate();
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  async function logout() {
    await api.logout();
    navigate('/login', { replace: true });
  }
  return (
    <AppShell
      rail={
        <NavRail
          switchName={switchId}
          items={switchNav(switchId)}
          active={`/switches/${switchId}/interfaces`}
          onNav={navigate}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
        />
      }
    >
      <ResourceList<IfaceRow>
        switchId={switchId}
        path="/interface"
        pathTemplate="/interface/{interface-id}"
        title="Interfaces"
        columns={COLUMNS}
        rowId={(row) => row.__id}
      />
    </AppShell>
  );
}
