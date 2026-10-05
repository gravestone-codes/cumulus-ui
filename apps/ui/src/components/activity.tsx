/**
 * ActivityList: compact audit rows — relative time, user, method chip, short
 * path. One row per line, no wrapping paths. Clickable rows open the audit
 * page; the caller decides where (switch scope) or nothing.
 */
import type { AuditRow } from '../lib/api.js';
import { timeAgo } from '../lib/format.js';

/** Collapse a raw audit path to what a human scans: the NVUE path for reads. */
export function shortAuditPath(method: string, path: string): string {
  try {
    const url = new URL(path, 'http://x');
    const probed = url.searchParams.get('path');
    if (probed) return `${method} ${probed}`;
    return `${method} ${url.pathname.replace(/^\/api\/v1/, '') || '/'}`;
  } catch {
    return `${method} ${path}`;
  }
}

const METHOD_TONE: Record<string, string> = {
  GET: 'var(--color-pass)',
  POST: 'var(--color-brand)',
  PUT: 'var(--color-brand)',
  PATCH: 'var(--color-brand)',
  DELETE: 'var(--color-fail)',
};

export function ActivityList({ rows, onOpen }: { rows: AuditRow[]; onOpen?: (row: AuditRow) => void }) {
  if (rows.length === 0) {
    return <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Nothing audited here yet.</p>;
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
      {rows.map((a) => {
        const body = (
          <>
            <span style={{ color: 'var(--color-muted)', minWidth: 62, flexShrink: 0 }}>{timeAgo(a.ts)}</span>
            <span
              style={{
                color: 'var(--color-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {a.username}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                color: METHOD_TONE[a.method] ?? 'var(--color-muted)',
                flexShrink: 0,
              }}
            >
              {a.method}
            </span>
            <span
              style={{
                color: 'var(--color-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`${a.method} ${a.path}`}
            >
              {shortAuditPath(a.method, a.path).slice(a.method.length + 1)}
            </span>
          </>
        );
        return (
          <li key={a.id}>
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(a)}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 8,
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 13,
                  padding: '6px 4px',
                  textAlign: 'left',
                }}
              >
                {body}
              </button>
            ) : (
              <div
                style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 13, padding: '6px 4px' }}
              >
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
