/** Sign-in (final language: line fields, SVG eye, spinner submit). */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { EyeOff, EyeOpen } from '../components/Eye.js';
import { DevReset } from '../components/DevReset.js';

export function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.login({ username: username.trim(), password });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
      setPassword('');
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
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 360 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', textAlign: 'center' }}>
          Sign in to Junction
        </h1>
        <div style={{ height: 28 }} />
        <label style={{ fontSize: 12, fontWeight: 600 }}>Username</label>
        <div className="lf">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="admin"
            autoFocus
          />
        </div>
        <label style={{ fontSize: 12, fontWeight: 600, marginTop: 16, display: 'block' }}>Password</label>
        <div className="lf">
          <input
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••••••"
          />
          <button
            type="button"
            className="end"
            aria-label={show ? 'Hide password' : 'Show password'}
            onClick={() => setShow((s) => !s)}
          >
            {show ? <EyeOff /> : <EyeOpen />}
          </button>
        </div>
        {error && <p style={{ color: 'var(--color-fail)', fontSize: 12, marginTop: 8 }}>{error}</p>}
        <button type="submit" className="btn" style={{ marginTop: 24 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p style={{ color: 'var(--color-muted)', fontSize: 12, textAlign: 'center', marginTop: 16 }}>
          Contact your administrator for access.
        </p>
        <DevReset />
      </form>
    </div>
  );
}
