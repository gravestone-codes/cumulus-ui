/**
 * First-boot setup wizard (roadmap §8). Rendered only while the users table
 * is empty — afterwards the route 404s server-side. Max 2 questions per step;
 * invalid fields shake, errors reserve space so nothing jumps.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api.js';
import { DevReset } from '../components/DevReset.js';
import { useFieldErrors } from '../components/fields.js';

export function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const fields = useFieldErrors();

  function next() {
    fields.clearAll();
    if (!id.trim()) fields.flag('id', 'Enter a username.');
    if (!displayName.trim()) fields.flag('displayName', 'Enter a display name.');
    if (!id.trim() || !displayName.trim()) return;
    setStep(1);
  }

  async function finish() {
    fields.clearAll();
    if (password.length < 12) {
      fields.flag('password', 'At least 12 characters.');
      return;
    }
    if (password !== confirm) {
      fields.flag('confirm', 'Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.setupAdmin({ id: id.trim().toLowerCase(), display_name: displayName.trim(), password });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      fields.flag('password', err instanceof ApiError ? err.message : 'Setup failed.');
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
          Welcome to Cumulus Junction
        </h1>
        <p style={{ color: 'var(--color-muted)', fontSize: 14, textAlign: 'center', margin: '6px 0 28px' }}>
          {step === 0 ? 'Step 1 of 2 your administrator identity' : 'Step 2 of 2 secure it'}
        </p>
        {step === 0 && (
          <>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Username</label>
            <div {...fields.fieldProps('id')}>
              <input
                value={id}
                onChange={(e) => {
                  setId(e.target.value);
                  fields.clear('id');
                }}
                placeholder="admin"
                autoFocus
                autoComplete="username"
              />
            </div>
            <fields.Err field="id" />
            <label style={{ fontSize: 13, fontWeight: 600, marginTop: 8, display: 'block' }}>
              Display name
            </label>
            <div {...fields.fieldProps('displayName')}>
              <input
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  fields.clear('displayName');
                }}
                placeholder="Names"
                autoComplete="nickname"
              />
            </div>
            <fields.Err field="displayName" />
            <button type="button" className="btn" style={{ marginTop: 16 }} onClick={next}>
              Continue
            </button>
          </>
        )}
        {step === 1 && (
          <>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Password</label>
            <div {...fields.fieldProps('password')}>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  fields.clear('password');
                }}
                placeholder="••••••••••••"
                autoComplete="new-password"
                autoFocus
              />
            </div>
            <fields.Err field="password" />
            <p style={{ color: 'var(--color-muted)', fontSize: 13, marginTop: 4 }}>At least 12 characters.</p>
            <label style={{ fontSize: 13, fontWeight: 600, marginTop: 12, display: 'block' }}>
              Confirm password
            </label>
            <div {...fields.fieldProps('confirm')}>
              <input
                type="password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value);
                  fields.clear('confirm');
                }}
                placeholder="••••••••••••"
                autoComplete="new-password"
              />
            </div>
            <fields.Err field="confirm" />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setStep(0)}>
                Back
              </button>
              <button type="button" className="btn" disabled={busy} onClick={finish}>
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
