/**
 * Presence (R19, roadmap 4.3): coordination, never a lock. Open editors
 * heartbeat their paths; object screens show a non-blocking banner naming
 * who else is editing or holds unapplied staged work there, with a
 * read-only view of their staged changes.
 */
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type PresenceEntry } from '../../lib/api.js';
import { Alert, Modal, Spinner, Tabs } from '../../components/ui.js';
import { DiffList } from './ChangeFlow.js';

/** Under the backend's 90s staleness window, with room for one missed beat. */
const HEARTBEAT_MS = 30_000;

/** Heartbeat `path` on each switch while mounted. Failures are silent — presence is advisory. */
export function useHeartbeat(switches: string[], path: string): void {
  const key = switches.join('\n');
  useEffect(() => {
    if (!key) return;
    const beat = () => {
      for (const sw of key.split('\n')) void api.heartbeat(sw, path).catch(() => undefined);
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [key, path]);
}

interface Other {
  userSub: string;
  username: string;
  open: boolean;
  /** Members where they are present, with their staged-path count there. */
  where: Array<{ switchId: string; staged: number }>;
}

/** Fold per-switch presence into one row per user. */
function byUser(perSwitch: Array<[string, PresenceEntry[]]>): Other[] {
  const out = new Map<string, Other>();
  for (const [switchId, entries] of perSwitch) {
    for (const e of entries) {
      const o = out.get(e.userSub) ?? { userSub: e.userSub, username: e.username, open: false, where: [] };
      o.open ||= e.open;
      o.where.push({ switchId, staged: e.staged });
      out.set(e.userSub, o);
    }
  }
  return [...out.values()];
}

/** Who else is on `path` across `members`; group scope names the members. */
export function PresenceBanner({
  members,
  path,
  label,
  group,
}: {
  members: string[];
  path: string;
  /** Object name in the sentence, e.g. "swp32". */
  label: string;
  group: boolean;
}) {
  const [viewing, setViewing] = useState<Other | null>(null);
  const q = useQuery({
    queryKey: ['presence', path, members],
    queryFn: async () =>
      byUser(
        await Promise.all(
          members.map(
            async (sw) => [sw, await api.presence(sw, path).catch(() => [])] as [string, PresenceEntry[]],
          ),
        ),
      ),
    refetchInterval: HEARTBEAT_MS,
    enabled: members.length > 0,
  });
  const others = q.data ?? [];
  if (others.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <Alert tone="note">
        {others.map((o) => (
          <div key={o.userSub}>
            <strong>{o.username}</strong> {o.open ? 'is editing' : 'has unapplied changes to'} {label}
            {group && ` on ${o.where.map((w) => w.switchId).join(', ')}`}
            {o.where.some((w) => w.staged > 0) && (
              <>
                {' · '}
                <button type="button" style={linkBtn} onClick={() => setViewing(o)}>
                  view their changes
                </button>
              </>
            )}
          </div>
        ))}
        <div style={{ color: 'var(--color-muted)', fontSize: 13, marginTop: 4 }}>
          You can still edit — overlapping changes are caught at apply.
        </div>
      </Alert>
      {viewing && <TheirChanges other={viewing} path={path} onClose={() => setViewing(null)} />}
    </div>
  );
}

/** Read-only view of another user's staged changes on `path`, per switch. */
function TheirChanges({ other, path, onClose }: { other: Other; path: string; onClose: () => void }) {
  const switches = other.where.filter((w) => w.staged > 0).map((w) => w.switchId);
  const [tab, setTab] = useState(switches[0] ?? '');
  const q = useQuery({
    queryKey: ['presence-staged', other.userSub, tab, path],
    queryFn: () => api.theirStaged(tab, other.userSub, path),
    enabled: tab !== '',
  });
  return (
    <Modal open onClose={onClose} title={`${other.username}’s unapplied changes`}>
      {switches.length > 1 && (
        <Tabs tabs={switches.map((sw) => ({ id: sw, label: sw }))} active={tab} onChange={setTab} />
      )}
      {q.isPending ? (
        <Spinner label="Loading their changes" />
      ) : q.error ? (
        <Alert tone="warn">{q.error.message}</Alert>
      ) : (
        <>
          <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '0 0 12px' }}>
            Staged on {tab} (branch {q.data.branch}), not applied. Read-only.
          </p>
          <DiffList rows={q.data.diffs} />
        </>
      )}
    </Modal>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
};
