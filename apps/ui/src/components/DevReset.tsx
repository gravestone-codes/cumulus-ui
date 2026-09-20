/**
 * DEV-ONLY reset button (dangerous, on purpose): wipes all app state back to
 * first-boot so initial onboarding can be re-tested endlessly.
 * Never renders in production builds (import.meta.env.DEV) and the endpoint
 * itself refuses to register under NODE_ENV=production. Typed confirm required.
 */
import { useState } from 'react';
import { api, ApiError } from '../lib/api.js';

export function DevReset() {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!import.meta.env.DEV) return null;

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await api.devReset();
      window.location.href = '/setup';
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'reset failed');
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 32, textAlign: 'center' }}>
      {!confirming ? (
        <button type="button" className="btn btn-danger auto sm" onClick={() => setConfirming(true)}>
          Reset (dev only)
        </button>
      ) : (
        <div
          style={{
            border: '1px solid var(--color-fail)',
            borderRadius: 12,
            padding: 16,
            maxWidth: 320,
            margin: '0 auto',
          }}
        >
          <p style={{ fontSize: 14, marginBottom: 8 }}>
            Wipes <b>all</b> users, switches, sessions and audit history. Type <b>RESET</b> to confirm.
          </p>
          <div className="lf" style={{ marginBottom: 10 }}>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="RESET"
              aria-label="Type RESET to confirm"
            />
          </div>
          {error && <p style={{ color: 'var(--color-fail)', fontSize: 13 }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-danger auto sm"
              disabled={busy || typed !== 'RESET'}
              onClick={reset}
            >
              {busy ? 'Resetting…' : 'Wipe everything'}
            </button>
            <button
              type="button"
              className="btn btn-secondary auto sm"
              onClick={() => {
                setConfirming(false);
                setTyped('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
