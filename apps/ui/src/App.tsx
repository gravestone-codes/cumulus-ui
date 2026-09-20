/**
 * Routes: first-boot setup, login, onboarding, and switch-scoped screens.
 * Gate decides the landing: uninitialized → /setup, anonymous → /login.
 */
import { useEffect, useState } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { api } from './lib/api.js';
import { ToastProvider } from './components/ui.js';
import { Setup } from './screens/Setup.js';
import { Login } from './screens/Login.js';
import { OnboardSwitch } from './screens/OnboardSwitch.js';
import { BulkImport } from './screens/BulkImport.js';
import { Interfaces } from './screens/Interfaces.js';
import { SwitchHome } from './screens/SwitchHome.js';
import { FleetDashboard } from './screens/FleetDashboard.js';
import { Switches } from './screens/Switches.js';
import { Software } from './screens/Software.js';

const queryClient = new QueryClient();

function useSession() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.me(),
    retry: false,
    staleTime: 60_000,
  });
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const session = useSession();
  if (session.isPending) return null;
  if (session.isError) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Gate() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api
      .setupStatus()
      .then((s) => navigate(s.initialized ? '/login' : '/setup', { replace: true }))
      .catch(() => setReady(true));
  }, [navigate]);
  return ready ? (
    <p style={{ padding: 32, color: 'var(--color-fail)' }}>Backend unreachable. Start the API and reload.</p>
  ) : null;
}

const router = createBrowserRouter([
  { path: '/', element: <Gate /> },
  { path: '/setup', element: <Setup /> },
  { path: '/login', element: <Login /> },
  {
    path: '/dashboard',
    element: (
      <RequireAuth>
        <FleetDashboard />
      </RequireAuth>
    ),
  },
  {
    path: '/switches',
    element: (
      <RequireAuth>
        <Switches />
      </RequireAuth>
    ),
  },
  {
    path: '/software',
    element: (
      <RequireAuth>
        <Software />
      </RequireAuth>
    ),
  },
  {
    path: '/switches/new',
    element: (
      <RequireAuth>
        <OnboardSwitch />
      </RequireAuth>
    ),
  },
  {
    path: '/switches/bulk',
    element: (
      <RequireAuth>
        <BulkImport />
      </RequireAuth>
    ),
  },
  {
    path: '/switches/:switchId/interfaces',
    element: (
      <RequireAuth>
        <Interfaces />
      </RequireAuth>
    ),
  },
  {
    path: '/switches/:switchId',
    element: (
      <RequireAuth>
        <SwitchHome />
      </RequireAuth>
    ),
  },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  );
}
