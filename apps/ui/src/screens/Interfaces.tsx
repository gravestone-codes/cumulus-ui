/**
 * Interfaces proof slice (3A.1–3A.7, read half): the first thin domain over
 * the generic ResourceList. Column choice is presentation; every value comes
 * from the query proxy. Edit (description/MTU/speed) lands with ResourceForm.
 */
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { AppShell, Breadcrumb, NavRail, usePinnedRail } from '../components/ui.js';
import { ResourceList } from '../components/resource.js';
import type { GridColumn } from '../components/DataTable.js';
import { firstDefined, getPath } from '../lib/format.js';
import { switchNav } from '../lib/nav.js';

type IfaceRow = Record<string, unknown> & { __id: string };

/** Interface state: operational link state, falling back to oper-status, then
 * to definitionally-up types (loopback is always up — no guessing). */
export function ifaceState(row: Record<string, unknown>): string | undefined {
  return (
    firstDefined(row, 'link/state', 'link/oper-status') ??
    (getPath(row, 'type') === 'loopback' ? 'up' : undefined)
  );
}

const COLUMNS: GridColumn<IfaceRow>[] = [
  { key: '__id', label: 'Name', always: true, value: (r) => String(r.__id) },
  { key: 'state', label: 'State', value: (r) => ifaceState(r) ?? '—' },
  { key: 'speed', label: 'Speed', value: (r) => firstDefined(r, 'link/speed') ?? '—' },
  { key: 'mtu', label: 'MTU', value: (r) => firstDefined(r, 'link/mtu') ?? '—' },
  { key: 'description', label: 'Description', value: (r) => firstDefined(r, 'description') ?? '—' },
];

export function Interfaces() {
  const { switchId = '' } = useParams();
  const navigate = useNavigate();
  const [collapsed, toggleCollapsed] = usePinnedRail('scope');
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  async function logout() {
    await api.logout();
    navigate('/login', { replace: true });
  }
  return (
    <AppShell
      rail={
        <NavRail
          brand={false}
          back={{ label: 'Switches', to: '/switches' }}
          scope={{ kind: 'switch', name: switchId }}
          items={switchNav(switchId)}
          active={`/switches/${switchId}/interfaces`}
          onNav={navigate}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
        />
      }
    >
      <Breadcrumb
        trail={[{ label: switchId, to: `/switches/${switchId}` }, { label: 'Interfaces' }]}
        onNav={navigate}
      />
      <ResourceList<IfaceRow>
        switchId={switchId}
        path="/interface"
        pathTemplate="/interface/{interface-id}"
        title="Interfaces"
        columns={COLUMNS}
        rowId={(row) => row.__id}
        storageKey="cumulus.interfaces.v1"
        rev="operational"
      />
    </AppShell>
  );
}
