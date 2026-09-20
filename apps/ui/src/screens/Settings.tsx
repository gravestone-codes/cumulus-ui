/**
 * Settings: everything about this platform (Junction itself) — users, roles,
 * groups, preferences. Switch controls never live here; they live under
 * /switches/:id (or a group scope). Cards show live counts; editors arrive
 * with the admin slice.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { GlobalShell } from './GlobalShell.js';

function useCount(queryKey: string[], run: () => Promise<unknown[]>) {
  const q = useQuery({ queryKey, queryFn: run, retry: false });
  if (q.isPending) return undefined;
  if (q.isError) return null;
  return q.data?.length ?? null;
}

function SettingCard({
  title,
  count,
  hint,
}: {
  title: string;
  count: number | null | undefined;
  hint: string;
}) {
  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        padding: 16,
      }}
    >
      <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-muted)', margin: '0 0 8px' }}>
        {title}
      </h2>
      <div style={{ fontSize: 26, fontWeight: 800 }}>{count ?? '—'}</div>
      <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '8px 0 0' }}>{hint}</p>
    </section>
  );
}

export function Settings() {
  const users = useCount(['users'], () => api.platformUsers());
  const roles = useCount(['roles'], () => api.platformRoles());
  const groups = useCount(['groups'], () => api.groups());
  return (
    <GlobalShell active="/settings">
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>Settings</h1>
      <p style={{ color: 'var(--color-muted)', fontSize: 14, margin: '0 0 16px' }}>
        This platform — who can sign in, what they may do, how switches are grouped. Counts hide when your
        role may not see them.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <SettingCard
          title="Users"
          count={users}
          hint="Platform sign-ins. Editors arrive with the admin slice."
        />
        <SettingCard title="Roles" count={roles} hint="Deny-by-default gates. Custom roles included." />
        <SettingCard title="Groups" count={groups} hint="Fan-out scopes, managed during onboarding." />
      </div>
    </GlobalShell>
  );
}
