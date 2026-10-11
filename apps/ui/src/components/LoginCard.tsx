/**
 * LoginCard (design §7 login): the centered sign-in card — line fields, SVG
 * eye, spinner submit, shake-once errors in reserved slots. Purely
 * presentational; screens own credentials and the submit call. A new `error`
 * flags the password field and clears it, matching the screen behavior.
 */
import { useEffect, useRef, useState } from 'react';
import { EyeOff, EyeOpen } from './Eye.js';
import { useFieldErrors } from './fields.js';

export interface LoginValues {
  username: string;
  password: string;
}

export function LoginCard({
  busy = false,
  error,
  onSubmit,
}: {
  busy?: boolean;
  /** Latest submit failure (each new value flags + clears the password). */
  error?: string | null;
  onSubmit: (values: LoginValues) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const fields = useFieldErrors();
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!error) {
      seen.current = null;
      return;
    }
    if (error !== seen.current) {
      seen.current = error;
      fields.flag('password', error);
      setPassword('');
    }
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    fields.clearAll();
    if (!username.trim()) fields.flag('username', 'Enter your username.');
    if (!password) fields.flag('password', 'Enter your password.');
    if (!username.trim() || !password) return;
    onSubmit({ username: username.trim(), password });
  }

  return (
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
    </form>
  );
}
