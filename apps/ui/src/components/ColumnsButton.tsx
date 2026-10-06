/**
 * ColumnsButton: the customize-columns trigger + portal panel. Checkboxes
 * show/hide, arrows reorder (no drag), Reset restores the catalog. Ported
 * from GRG's ColumnCustomizeButton; portal keeps it clear of table overflow.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ColumnCatalogEntry, ColumnPrefs } from '../lib/columnPrefs.js';

const PANEL_W = 288;

export default function ColumnsButton<K extends string>({
  catalog,
  prefs,
  onToggle,
  onMove,
  onReset,
}: {
  catalog: ColumnCatalogEntry<K>[];
  prefs: ColumnPrefs<K>;
  onToggle: (key: K) => void;
  onMove: (key: K, dir: -1 | 1) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDoc = (e: MouseEvent) => {
      const node = e.target as HTMLElement;
      if (btnRef.current?.contains(node) || node.closest('[data-col-panel]')) return;
      setOpen(false);
    };
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
    setOpen((o) => !o);
  }

  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const fields = prefs.order.map((k) => byKey.get(k)).filter((f): f is ColumnCatalogEntry<K> => !!f);
  const left = rect ? Math.min(rect.right - PANEL_W, window.innerWidth - PANEL_W - 8) : 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        aria-label="Customize columns"
        title="Customize columns"
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
          <rect x="3" y="4" width="6" height="16" rx="1.3" stroke="currentColor" strokeWidth="1.7" />
          <rect x="9.5" y="4" width="5" height="16" rx="1.3" stroke="currentColor" strokeWidth="1.7" />
          <rect x="15" y="4" width="6" height="16" rx="1.3" stroke="currentColor" strokeWidth="1.7" />
        </svg>
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            data-col-panel
            role="dialog"
            aria-label="Customize columns"
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
                Columns
              </span>
              <button
                type="button"
                onClick={onReset}
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
            <ul
              style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, maxHeight: 320, overflowY: 'auto' }}
            >
              {fields.map((f, i) => {
                const visible = !prefs.hidden.includes(f.key);
                return (
                  <li
                    key={f.key}
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
                      checked={visible}
                      disabled={f.always}
                      onChange={() => onToggle(f.key)}
                      aria-label={`Show ${f.label}`}
                    />
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 14,
                        color: visible ? 'var(--color-text)' : 'var(--color-muted)',
                      }}
                    >
                      {f.label}
                      {f.always && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            textTransform: 'uppercase',
                            color: 'var(--color-muted)',
                          }}
                        >
                          pinned
                        </span>
                      )}
                    </span>
                    <span style={{ display: 'flex', gap: 2 }}>
                      <ArrowBtn label="Move up" disabled={i <= 1} onClick={() => onMove(f.key, -1)}>
                        ↑
                      </ArrowBtn>
                      <ArrowBtn
                        label="Move down"
                        disabled={i >= fields.length - 1}
                        onClick={() => onMove(f.key, 1)}
                      >
                        ↓
                      </ArrowBtn>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}

function ArrowBtn({
  children,
  label,
  disabled,
  onClick,
}: {
  children: string;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'grid',
        placeItems: 'center',
        width: 20,
        height: 20,
        background: 'transparent',
        border: 'none',
        borderRadius: 4,
        color: 'var(--color-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.3 : 1,
        font: 'inherit',
        fontSize: 12,
      }}
    >
      {children}
    </button>
  );
}
