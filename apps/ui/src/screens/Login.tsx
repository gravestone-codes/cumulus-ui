/** Sign-in screen: session + navigation around the LoginCard. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { DevReset } from '../components/DevReset.js';
import { LoginCard, type LoginValues } from '../components/LoginCard.js';

export function Login() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(values: LoginValues) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(values);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
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
        <LoginCard busy={busy} error={error} onSubmit={submit} />
        <DevReset />
      </div>
    </div>
  );
}
