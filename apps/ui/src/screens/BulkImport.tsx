/**
 * Bulk onboarding: paste CSV (id,display,url,group,user,password), run the
 * ceremony headlessly per row, review results + fingerprints.
 * Trust stays unverified per row until the interactive ceremony confirms it.
 */
import { useState } from 'react';
import { api, ApiError, type ImportResult } from '../lib/api.js';
import { parseCsv } from '../lib/csv.js';

export function BulkImport() {
  const [csv, setCsv] = useState(
    '# id,display,url,user,password[,group]\nleaf01,leaf01,https://leaf01:8765,cumulus,secret,DC1-leaf',
  );
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    const parsed = parseCsv(csv);
    if (parsed.error || parsed.rows.length === 0) {
      setError(parsed.error ?? 'nothing to import');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await api.importSwitches(parsed.rows));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', padding: 32 }}>
      <div style={{ width: '100%', maxWidth: 640 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Bulk onboarding</h1>
        <p style={{ color: 'var(--color-muted)', fontSize: 14, margin: '6px 0 16px' }}>
          One line per switch. Trust stays unverified until the interactive ceremony confirms each
          fingerprint.
        </p>
        <div className="lf">
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={8}
            spellCheck={false}
            style={{
              width: '100%',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              color: 'var(--color-text)',
              fontFamily: 'monospace',
              fontSize: 13,
              padding: 10,
            }}
          />
        </div>
        {error && <p style={{ color: 'var(--color-fail)', fontSize: 13, marginTop: 8 }}>{error}</p>}
        <button
          type="button"
          className="btn"
          style={{ marginTop: 16, maxWidth: 240 }}
          disabled={busy}
          onClick={run}
        >
          {busy ? 'Importing…' : 'Import switches'}
        </button>
        {result && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 20 }}>
            <thead>
              <tr
                style={{
                  textAlign: 'left',
                  color: 'var(--color-muted)',
                  fontSize: 12,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)' }}>Switch</th>
                <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)' }}>Result</th>
                <th style={{ padding: '8px 10px', borderBottom: '1px solid var(--color-border)' }}>
                  Fingerprint
                </th>
              </tr>
            </thead>
            <tbody>
              {result.results.map((r) => (
                <tr key={r.id}>
                  <td
                    className="mono"
                    style={{ padding: '9px 10px', borderBottom: '1px solid var(--color-border)' }}
                  >
                    {r.id}
                  </td>
                  <td
                    style={{
                      padding: '9px 10px',
                      borderBottom: '1px solid var(--color-border)',
                      color: r.ok ? 'var(--color-pass)' : 'var(--color-fail)',
                    }}
                  >
                    {r.ok ? '✓ staged (unverified)' : `✕ ${r.error ?? 'failed'}`}
                  </td>
                  <td
                    className="mono"
                    style={{
                      padding: '9px 10px',
                      borderBottom: '1px solid var(--color-border)',
                      fontSize: 12,
                      wordBreak: 'break-all',
                    }}
                  >
                    {r.fingerprint ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
