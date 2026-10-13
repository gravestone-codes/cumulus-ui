/**
 * ActivityList: compact audit rows — relative time, user, method chip, short
 * path in fixed columns, hairline-divided like every card list. One row per
 * line, no wrapping paths. Clickable rows open the audit
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

/** Fixed columns so a long name never shifts method and path: time · user · method · path. */
const COLUMNS = '52px minmax(0, 72px) 46px minmax(0, 1fr)';

const clip: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export function ActivityList({ rows, onOpen }: { rows: AuditRow[]; onOpen?: (row: AuditRow) => void }) {
  if (rows.length === 0) {
    return <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>Nothing audited here yet.</p>;
  }
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
      }}
    >
      {rows.map((a, i) => {
        const body = (
          <>
            <span style={{ ...clip, color: 'var(--color-muted)' }}>{timeAgo(a.ts)}</span>
            <span style={{ ...clip, color: 'var(--color-text)' }} title={a.username}>
              {a.username}
            </span>
            <span
              style={{
                ...clip,
                fontSize: 11,
                fontWeight: 800,
                color: METHOD_TONE[a.method] ?? 'var(--color-muted)',
              }}
            >
              {a.method}
            </span>
            <span style={{ ...clip, color: 'var(--color-muted)' }} title={`${a.method} ${a.path}`}>
              {shortAuditPath(a.method, a.path).slice(a.method.length + 1)}
            </span>
          </>
        );
        const row: React.CSSProperties = {
          display: 'grid',
          gridTemplateColumns: COLUMNS,
          alignItems: 'baseline',
          columnGap: 8,
          width: '100%',
          fontSize: 13,
          padding: '9px 0',
          borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
        };
        return (
          <li key={a.id}>
            {onOpen ? (
              <button
                type="button"
                onClick={() => onOpen(a)}
                // Resets first, row last: a later `border`/`font` shorthand would wipe the divider and size.
                style={{
                  background: 'transparent',
                  border: 'none',
                  font: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                  ...row,
                }}
              >
                {body}
              </button>
            ) : (
              <div style={row}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
