/**
 * FieldPicker: which schema fields a list loads and shows. The checked set
 * drives both the rendered columns and the `?include` patterns (roadmap
 * 2.1/R7) — one picker, no fetch/display split. Choice persists per table;
 * Reset restores the domain defaults. Portal menu, same language as the
 * column customizer; search appears past 7 fields (§7 dropdown behavior).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SchemaLeaf } from '../lib/schema.js';

const PANEL_W = 288;

export function FieldPicker({
  leaves,
  checked,
  defaults,
  onChange,
}: {
  /** Every pickable schema leaf. */
  leaves: SchemaLeaf[];
  /** Currently picked leaf paths. */
  checked: string[];
  /** Domain defaults for Reset. */
  defaults: string[];
  onChange: (paths: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const node = e.target as HTMLElement;
      if (btnRef.current?.contains(node) || node.closest('[data-field-panel]')) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  function toggleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setQuery('');
    setOpen((o) => !o);
  }

  const on = new Set(checked);
  const q = query.trim().toLowerCase();
  const shown = q ? leaves.filter((l) => l.label.toLowerCase().includes(q) || l.path.includes(q)) : leaves;
  const left = rect ? Math.min(rect.right - PANEL_W, window.innerWidth - PANEL_W - 8) : 0;

  function flip(path: string) {
    onChange(on.has(path) ? checked.filter((p) => p !== path) : [...checked, path]);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        aria-label="Pick fields"
        title="Pick fields"
        aria-expanded={open}
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          width: 28,
          height: 28,
          background: 'transparent',
          border: 'none',
          borderRadius: 6,
          color: 'var(--color-muted)',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="9" cy="6" r="2" fill="var(--color-surface)" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="15" cy="12" r="2" fill="var(--color-surface)" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="7" cy="18" r="2" fill="var(--color-surface)" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            data-field-panel
            role="dialog"
            aria-label="Pick fields"
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              width: PANEL_W,
              top: rect.bottom + 6,
              left,
              zIndex: 70,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 12,
              padding: 8,
              boxShadow: '0 16px 40px rgba(0,0,0,.5)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '4px 8px',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--color-muted)',
                }}
              >
                Fields · {checked.length} of {leaves.length}
              </span>
              <button
                type="button"
                onClick={() => onChange(defaults)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-muted)',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 12,
                }}
              >
                Reset
              </button>
            </div>
            {leaves.length > 7 && (
              <input
                aria-label="Search fields"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="select-search"
              />
            )}
            <ul
              style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, maxHeight: 320, overflowY: 'auto' }}
            >
              {shown.map((l) => {
                const isOn = on.has(l.path);
                return (
                  <li
                    key={l.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      borderRadius: 8,
                      padding: '6px 8px',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={() => flip(l.path)}
                      aria-label={`Show ${l.label}`}
                    />
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 14,
                        color: isOn ? 'var(--color-text)' : 'var(--color-muted)',
                      }}
                      title={l.path}
                    >
                      {l.label}
                    </span>
                  </li>
                );
              })}
              {shown.length === 0 && (
                <li style={{ fontSize: 13, color: 'var(--color-muted)', padding: '6px 8px' }}>
                  No fields match.
                </li>
              )}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
