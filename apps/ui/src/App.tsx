/**
 * Routes: first-boot setup, login, onboarding, and a placeholder dashboard.
 * Gate decides the landing: uninitialized → /setup, anonymous → /login.
 */
import { useEffect, useState } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { api } from './lib/api.js';
import { Setup } from './screens/Setup.js';
import { Login } from './screens/Login.js';
import { OnboardSwitch } from './screens/OnboardSwitch.js';
import { BulkImport } from './screens/BulkImport.js';

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

function Dashboard() {
  const navigate = useNavigate();
  const session = useSession();
  async function logout() {
    await api.logout();
    await queryClient.invalidateQueries({ queryKey: ['me'] });
    navigate('/login', { replace: true });
  }
  return (
    <div style={{ padding: 32, maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>Junction</h1>
      <p style={{ color: 'var(--color-muted)', fontSize: 13, margin: '6px 0 20px' }}>
        Signed in as {session.data?.user.display_name ?? session.data?.user.username ?? '…'}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary auto" onClick={() => navigate('/switches/new')}>
          Onboard a switch
        </button>
        <button type="button" className="btn btn-secondary auto" onClick={() => navigate('/switches/bulk')}>
          Bulk import
        </button>
        <button type="button" className="btn btn-secondary auto" onClick={logout}>
          Sign out
        </button>
      </div>
      <p style={{ color: 'var(--color-muted)', fontSize: 12, marginTop: 24 }}>
        Domain screens (interfaces, VRFs, BGP…) arrive in Phase 2–3. This shell proves auth, routing and the
        API loop.
      </p>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <Gate /> },
  { path: '/setup', element: <Setup /> },
  { path: '/login', element: <Login /> },
  {
    path: '/dashboard',
    element: (
      <RequireAuth>
        <Dashboard />
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
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
