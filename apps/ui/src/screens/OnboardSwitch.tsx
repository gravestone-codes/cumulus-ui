/**
 * Switch onboarding ceremony (roadmap §8): Add → Group → Trust → Credential
 * → Verify. Max 2 questions per stage. Trust is an explicit human decision;
 * every stage is a real backend call, never a mock.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, type GroupRow } from '../lib/api.js';

const STAGES = ['Add', 'Group', 'Trust', 'Credential', 'Verify'] as const;

export function OnboardSwitch() {
  const navigate = useNavigate();
  const [stage, setStage] = useState(0);
  const [id, setId] = useState('');
  const [url, setUrl] = useState('');
  const [group, setGroup] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [verified, setVerified] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: () => api.groups() });

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const sw = await run(() =>
      api.createSwitch({ id: id.trim(), display_name: id.trim(), base_url: url.trim() }),
    );
    if (!sw) return;
    setFingerprint(sw.cert_fingerprint);
    setStage(1);
  }

  async function saveGroup() {
    const target = newGroup.trim() || group;
    const done = await run(async () => {
      if (newGroup.trim()) {
        const g: GroupRow = await api
          .createGroup({ id: newGroup.trim(), display_name: newGroup.trim() })
          .catch((err: unknown) => {
            if (err instanceof ApiError && err.status === 409)
              return { id: newGroup.trim(), display_name: newGroup.trim() };
            throw err;
          });
        await api.setSwitchGroups(id.trim(), [g.id]);
        return true;
      }
      if (target) await api.setSwitchGroups(id.trim(), [target]);
      return true;
    });
    if (done) setStage(2);
  }

  async function trust() {
    const done = await run(() => api.trustSwitch(id.trim(), fingerprint ?? ''));
    if (done) setStage(3);
  }

  async function credential() {
    const done = await run(async () => {
      await api.setMyCredential(id.trim(), { switch_username: username.trim(), switch_password: password });
      await api.connectSwitch(id.trim());
      return true;
    });
    if (done) setStage(4);
  }

  async function verify() {
    const res = await run(() => api.verifySwitch(id.trim()));
    if (res) setVerified(res.data);
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', textAlign: 'center' }}>
          Onboard a switch
        </h1>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', margin: '12px 0 28px' }}>
          {STAGES.map((s, i) => (
            <span
              key={s}
              title={s}
              style={{
                width: 28,
                height: 4,
                borderRadius: 2,
                background:
                  i < stage
                    ? 'var(--color-pass)'
                    : i === stage
                      ? 'var(--color-brand)'
                      : 'var(--color-border)',
              }}
            />
          ))}
        </div>

        {stage === 0 && (
          <>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Switch ID</label>
            <div className="lf">
              <input value={id} onChange={(e) => setId(e.target.value)} placeholder="leaf01" autoFocus />
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, marginTop: 16, display: 'block' }}>
              Management URL
            </label>
            <div className="lf">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://leaf01:8765"
                inputMode="url"
              />
            </div>
            {error && <p style={{ color: 'var(--color-fail)', fontSize: 12, marginTop: 8 }}>{error}</p>}
            <button
              type="button"
              className="btn"
              style={{ marginTop: 24 }}
              disabled={busy || !id.trim() || !url.trim()}
              onClick={add}
            >
              {busy ? 'Reaching switch…' : 'Add switch'}
            </button>
          </>
        )}

        {stage === 1 && (
          <>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Group</label>
            <div className="lf">
              <select
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  padding: '8px 0',
                  outline: 'none',
                  font: 'inherit',
                }}
              >
                <option value="">Ungrouped</option>
                {(groupsQuery.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.display_name}
                  </option>
                ))}
              </select>
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, marginTop: 16, display: 'block' }}>
              Or new group
            </label>
            <div className="lf">
              <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="DC1-leaf" />
            </div>
            {error && <p style={{ color: 'var(--color-fail)', fontSize: 12, marginTop: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setStage(0)}>
                Back
              </button>
              <button type="button" className="btn" disabled={busy} onClick={saveGroup}>
                {busy ? 'Saving…' : 'Continue'}
              </button>
            </div>
          </>
        )}

        {stage === 2 && (
          <>
            <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 12 }}>
              Compare this fingerprint with the switch console (
              <span className="mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
                nv show system api
              </span>
              ), then confirm.
            </p>
            <div
              className="mono"
              style={{
                fontSize: 12,
                wordBreak: 'break-all',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                padding: 12,
              }}
            >
              {fingerprint ?? '—'}
            </div>
            {error && <p style={{ color: 'var(--color-fail)', fontSize: 12, marginTop: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setStage(1)}>
                Back
              </button>
              <button type="button" className="btn" disabled={busy || !fingerprint} onClick={trust}>
                {busy ? 'Recording…' : 'Fingerprints match'}
              </button>
            </div>
          </>
        )}

        {stage === 3 && (
          <>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Switch username</label>
            <div className="lf">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="cumulus"
                autoComplete="username"
                autoFocus
              />
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, marginTop: 16, display: 'block' }}>
              Switch password
            </label>
            <div className="lf">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
              />
            </div>
            {error && <p style={{ color: 'var(--color-fail)', fontSize: 12, marginTop: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setStage(2)}>
                Back
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || !username || !password}
                onClick={credential}
              >
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
          </>
        )}

        {stage === 4 && !verified && (
          <>
            <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 12 }}>
              Read-only proof of life before finishing.
            </p>
            {error && <p style={{ color: 'var(--color-fail)', fontSize: 12, marginTop: 8 }}>{error}</p>}
            <button type="button" className="btn" disabled={busy} onClick={verify}>
              {busy ? 'Probing…' : 'Verify switch'}
            </button>
          </>
        )}

        {stage === 4 && verified !== null && (
          <>
            <div
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 12,
                padding: 16,
                fontSize: 13,
              }}
            >
              <p style={{ fontWeight: 700, marginBottom: 8, color: 'var(--color-pass)' }}>✓ {id} is live</p>
              <pre
                className="mono"
                style={{
                  fontSize: 12,
                  color: 'var(--color-muted)',
                  whiteSpace: 'pre-wrap',
                  maxHeight: 220,
                  overflow: 'auto',
                }}
              >
                {JSON.stringify(verified, null, 2)}
              </pre>
            </div>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 24 }}
              onClick={() => navigate('/dashboard')}
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
