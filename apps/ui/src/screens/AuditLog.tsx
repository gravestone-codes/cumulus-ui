/**
 * Audit Log (switch scope): every audited action on this switch, newest
 * first. Reads come from the platform audit trail, not the switch.
 */
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import type { AuditRow } from '../lib/api.js';
import { Alert, AppShell, NavRail, usePinnedRail } from '../components/ui.js';
import { Breadcrumb } from '../components/ui.js';
import { DataTable } from '../components/DataTable.js';
import type { GridColumn } from '../components/DataTable.js';
import { shortAuditPath } from '../components/activity.js';
import { timeAgo } from '../lib/format.js';
import { switchNav } from '../lib/nav.js';

const COLUMNS: GridColumn<AuditRow>[] = [
  { key: 'time', label: 'Time', value: (r) => timeAgo(r.ts) },
  { key: 'user', label: 'User', always: true, value: (r) => r.username },
  { key: 'method', label: 'Method', value: (r) => r.method },
  { key: 'path', label: 'Path', value: (r) => shortAuditPath(r.method, r.path).slice(r.method.length + 1) },
];

export function AuditLog() {
  const { switchId = '' } = useParams();
  const navigate = useNavigate();
  const [collapsed, toggleCollapsed] = usePinnedRail('scope');
  const session = useQuery({ queryKey: ['me'], queryFn: () => api.me(), retry: false });
  const audit = useQuery({
    queryKey: ['audit-switch-full', switchId],
    queryFn: () => api.audit(100, switchId),
    retry: false,
  });
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
          active={`/switches/${switchId}/audit`}
          onNav={navigate}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
          user={session.data?.user.display_name ?? session.data?.user.username}
          onLogout={logout}
        />
      }
    >
      <Breadcrumb
        trail={[{ label: switchId, to: `/switches/${switchId}` }, { label: 'Audit Log' }]}
        onNav={navigate}
      />
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 12px' }}>Audit Log</h1>
      {audit.isError && <Alert tone="fail">Could not load audit: {audit.error.message}</Alert>}
      {!audit.isError && (
        <DataTable
          cols={COLUMNS}
          rows={audit.data ?? []}
          loading={audit.isPending}
          storageKey="cumulus.audit.v1"
        />
      )}
    </AppShell>
  );
}
