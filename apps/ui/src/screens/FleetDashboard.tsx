/**
 * Fleet dashboard: the welcome screen. Personal per user (Dashboard, scope
 * fleet); every number comes from live endpoints through the widget library.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Alert } from '../components/ui.js';
import { GlobalShell } from './GlobalShell.js';
import { Dashboard } from './dashboard/Dashboard.js';

export function FleetDashboard() {
  const switches = useQuery({ queryKey: ['switches'], queryFn: () => api.switches(), retry: false });
  return (
    <GlobalShell active="/dashboard">
      {switches.isError ? (
        <Alert tone="fail">Could not load switches: {switches.error.message}</Alert>
      ) : (
        <Dashboard
          scope="fleet"
          switches={switches.data ?? []}
          title="Dashboard"
          hint="Every switch, at a glance."
        />
      )}
    </GlobalShell>
  );
}
