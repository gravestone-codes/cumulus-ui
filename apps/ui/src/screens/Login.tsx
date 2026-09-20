/** Sign-in (final language: line fields, SVG eye, spinner submit, shake + reserved errors). */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { EyeOff, EyeOpen } from '../components/Eye.js';
import { DevReset } from '../components/DevReset.js';
import { useFieldErrors } from '../components/fields.js';

export function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const fields = useFieldErrors();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    fields.clearAll();
    if (!username.trim()) fields.flag('username', 'Enter your username.');
    if (!password) fields.flag('password', 'Enter your password.');
    if (!username.trim() || !password) return;
    setBusy(true);
    try {
      await api.login({ username: username.trim(), password });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      fields.flag('password', err instanceof ApiError ? err.message : 'Sign-in failed.');
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
          Sign in to Cumulus Junction
        </h1>
        <div style={{ height: 28 }} />
        <label style={{ fontSize: 13, fontWeight: 600 }}>Username</label>
        <div {...fields.fieldProps('username')}>
          <input
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              fields.clear('username');
            }}
            autoComplete="username"
            placeholder="admin"
            autoFocus
          />
        </div>
        <fields.Err field="username" />
        <label style={{ fontSize: 13, fontWeight: 600, marginTop: 8, display: 'block' }}>Password</label>
        <div {...fields.fieldProps('password')}>
          <input
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              fields.clear('password');
            }}
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
        <fields.Err field="password" />
        <button type="submit" className="btn" style={{ marginTop: 16 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p style={{ color: 'var(--color-muted)', fontSize: 13, textAlign: 'center', marginTop: 16 }}>
          Contact your administrator for access.
        </p>
        <DevReset />
      </form>
    </div>
  );
}
