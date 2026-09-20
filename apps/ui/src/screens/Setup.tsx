/**
 * First-boot setup wizard (roadmap §8). Rendered only while the users table
 * is empty — afterwards the route 404s server-side. Max 2 questions per step.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { DevReset } from '../components/DevReset.js';

export function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finish() {
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.setupAdmin({ id: id.trim().toLowerCase(), display_name: displayName.trim(), password });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup failed.');
      setBusy(false);
    }
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
      <div style={{ width: '100%', maxWidth: 360 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', textAlign: 'center' }}>
          Welcome to Cumulus
        </h1>
        <p style={{ color: 'var(--color-muted)', fontSize: 13, textAlign: 'center', margin: '6px 0 28px' }}>
          {step === 0 ? 'Step 1 of 2 your administrator identity' : 'Step 2 of 2 secure it'}
        </p>
        {step === 0 && (
          <>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Username</label>
            <div className="lf">
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="admin"
                autoFocus
                autoComplete="username"
              />
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, marginTop: 16, display: 'block' }}>
              Display name
            </label>
            <div className="lf">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Names"
                autoComplete="nickname"
              />
            </div>
            <button
              type="button"
              className="btn"
              style={{ marginTop: 24 }}
              onClick={() => {
                if (!id.trim() || !displayName.trim()) {
                  setError('Enter a username and a display name.');
                  return;
                }
                setError(null);
                setStep(1);
              }}
            >
              Continue
            </button>
            {error && step === 0 && (
              <p style={{ color: 'var(--color-fail)', fontSize: 12, marginTop: 8 }}>{error}</p>
            )}
          </>
        )}
        {step === 1 && (
          <>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Password</label>
            <div className="lf">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="new-password"
                autoFocus
              />
            </div>
            <label style={{ fontSize: 12, fontWeight: 600, marginTop: 16, display: 'block' }}>
              Confirm password
            </label>
            <div className="lf">
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="new-password"
              />
            </div>
            {error && <p style={{ color: 'var(--color-fail)', fontSize: 12, marginTop: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 24 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  if (password.length < 12) {
                    setError('Password must be at least 12 characters.');
                    return;
                  }
                  finish();
                }}
              >
                {busy ? 'Creating…' : 'Create admin'}
              </button>
            </div>
          </>
        )}
        <DevReset />
      </div>
    </div>
  );
}
