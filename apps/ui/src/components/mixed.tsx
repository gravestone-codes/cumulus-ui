/**
 * Group value markers (design/interfaces.html §3A, §6): a value members
 * disagree on reads "mixed" inline and opens a who-has-what popover with
 * Align / Open actions; a per-switch value shows a lock and its spread.
 * One component each — every group screen composes these, never copies.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ValueGroup {
  value: string;
  switches: string[];
}

const chip: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  border: '1px solid color-mix(in srgb, var(--color-warn) 45%, transparent)',
  borderRadius: 5,
  padding: '0 5px',
  lineHeight: '16px',
};

/** Small SVG lock (design language: SVG icons only). */
export function LockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

/**
 * Inline "mixed" marker. Click opens the breakdown; `onAlign` offers
 * "Align all to <majority>", `onOpen` jumps to one member.
 */
export function MixedValue({
  groups,
  label,
  show = (v) => v || '—',
  onAlign,
  onOpen,
}: {
  groups: ValueGroup[];
  /** Field name for the popover heading and aria label. */
  label: string;
  show?: (value: string) => string;
  onAlign?: (value: string) => void;
  onOpen?: (switchId: string) => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!rect) return;
    const close = () => setRect(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [rect]);
  const top = groups[0];
  const summary =
    groups.length === 2 && groups.every((g) => g.value.length <= 10)
      ? groups.map((g) => `${show(g.value)} ×${g.switches.length}`).join(', ')
      : 'mixed';
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={`${label}: ${groups.length} different values`}
        aria-expanded={rect !== null}
        onClick={(e) => {
          e.stopPropagation();
          setRect(rect ? null : (btn.current?.getBoundingClientRect() ?? null));
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          borderBottom: '1px dashed color-mix(in srgb, var(--color-warn) 60%, transparent)',
          padding: 0,
          color: 'var(--color-warn)',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 'inherit',
        }}
      >
        <span style={chip}>{groups.length}</span>
        {summary}
      </button>
      {rect &&
        createPortal(
          <div
            role="dialog"
            aria-label={`${label} by switch`}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: Math.min(rect.bottom + 6, window.innerHeight - 260),
              left: Math.min(rect.left, window.innerWidth - 300),
              width: 280,
              zIndex: 70,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              padding: 12,
              boxShadow: '0 16px 40px rgba(0,0,0,.5)',
              fontSize: 13,
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--color-muted)',
                margin: '0 0 6px',
              }}
            >
              {label} by switch
            </p>
            {groups.map((g, i) => (
              <div
                key={g.value}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '5px 0',
                  color: i === 0 ? 'var(--color-text)' : 'var(--color-warn)',
                }}
              >
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  {g.switches.map((sw, j) => (
                    <span key={sw}>
                      {j > 0 && ', '}
                      {onOpen ? (
                        <button
                          type="button"
                          onClick={() => {
                            setRect(null);
                            onOpen(sw);
                          }}
                          style={linkBtn}
                        >
                          {sw}
                        </button>
                      ) : (
                        sw
                      )}
                    </span>
                  ))}
                </span>
                <strong style={{ whiteSpace: 'pre-wrap', textAlign: 'right' }}>{show(g.value)}</strong>
              </div>
            ))}
            {onAlign && top && (
              <button
                type="button"
                className="btn"
                style={{ marginTop: 10, width: '100%' }}
                onClick={() => {
                  setRect(null);
                  onAlign(top.value);
                }}
              >
                Align all to {show(top.value)}
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
};

/** Per-switch value marker: lock + spread ("4 values"), breakdown on click like MixedValue. */
export function PerSwitchValue({
  groups,
  label,
  show,
  onOpen,
}: {
  groups: ValueGroup[];
  label: string;
  show?: (value: string) => string;
  onOpen?: (switchId: string) => void;
}): ReactNode {
  const distinct = groups.length;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--color-muted)' }}>
      <LockIcon />
      <span style={{ fontSize: 13 }}>per switch</span>
      {distinct > 1 ? (
        <MixedValue groups={groups} label={label} show={show} onOpen={onOpen} />
      ) : (
        <span style={{ color: 'var(--color-text)', fontSize: 'inherit' }}>
          {show?.(groups[0]?.value ?? '') ?? groups[0]?.value}
        </span>
      )}
    </span>
  );
}
