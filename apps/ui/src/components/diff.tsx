/**
 * DiffList: staged paths as before → after rows. Shared by the dry-run
 * review and the read-only view of others' staged work (roadmap R19/R21) —
 * one element, one component.
 */
import type { StagedDiff } from '../lib/api.js';

const shortVal = (v: unknown) =>
  v === undefined || v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** Staged paths as before → after rows (own dry-run and others' staged work share it). */
export function DiffList({ rows }: { rows: StagedDiff[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
      {rows.map((d, i) => (
        <li
          key={`${d.path}-${i}`}
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 13,
            overflowWrap: 'anywhere',
          }}
        >
          <span className="mono">
            {d.method === 'DELETE' ? 'remove ' : ''}
            {decodeURIComponent(d.path)}
          </span>
          <br />
          <span style={{ color: 'var(--color-muted)' }}>{shortVal(d.before)} → </span>
          <span style={{ color: 'var(--color-text)', fontWeight: 700 }}>
            {d.method === 'DELETE' ? 'removed' : shortVal(d.mine)}
          </span>
        </li>
      ))}
    </ul>
  );
}
