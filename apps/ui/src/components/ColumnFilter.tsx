/**
 * Per-column filter: funnel icon in the header opening a portal popover —
 * operator (includes/is/is not/is one of) + value. Ported from GRG's
 * ColumnFilter (text columns): typing drafts locally and commits on Enter,
 * Apply, or click-out so the table never jumps mid-thought.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SelectMenu } from './ui.js';
import { filterActive } from '../lib/table.js';
import type { ColumnFilterState, FilterOp } from '../lib/table.js';

const DEFAULT_FILTER: ColumnFilterState = { op: 'includes', value: '', values: [] };

const OPS: Array<{ value: FilterOp; label: string }> = [
  { value: 'includes', label: 'includes' },
  { value: 'is', label: 'is' },
  { value: 'isNot', label: 'is not' },
  { value: 'isOneOf', label: 'is one of' },
];

/** A filter narrows only once it carries the value(s) it needs. */

const PANEL_W = 264;

export default function ColumnFilter({
  label,
  filter,
  distinct,
  onChange,
}: {
  label: string;
  filter: ColumnFilterState | undefined;
  distinct: string[];
  onChange: (f: ColumnFilterState | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);

  const active = filterActive(filter);
  const f: ColumnFilterState = { ...DEFAULT_FILTER, ...filter };
  const commitRef = useRef(() => {});
  commitRef.current = () => onChange({ ...f, value: draft });

  useEffect(() => {
    if (!open) return;
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setQuery('');
    setDraft(f.value);
    const onDoc = (e: MouseEvent) => {
      const n = e.target as Element;
      if (btnRef.current?.contains(n)) return;
      commitRef.current();
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shownDistinct = query
    ? distinct.filter((d) => d.toLowerCase().includes(query.toLowerCase()))
    : distinct;
  const left = rect ? Math.min(Math.max(8, rect.left), window.innerWidth - PANEL_W - 8) : 0;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label={`Filter ${label}`}
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          width: 20,
          height: 20,
          background: 'transparent',
          border: 'none',
          borderRadius: 4,
          color: active ? 'var(--color-brand)' : 'var(--color-muted)',
          opacity: active ? 1 : 0.45,
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M4 5h16l-6 7v5l-4 2v-7L4 5z" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            role="dialog"
            aria-label={`Filter ${label}`}
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
              padding: 12,
              boxShadow: '0 16px 40px rgba(0,0,0,.5)',
            }}
          >
            <label style={{ display: 'block', fontSize: 12, color: 'var(--color-muted)', marginBottom: 6 }}>
              Operator
            </label>
            <div style={{ marginBottom: 10 }}>
              <SelectMenu
                label="Operator"
                value={f.op}
                options={OPS.map((o) => ({ value: o.value, label: o.label }))}
                onChange={(v) => onChange({ ...f, op: v as FilterOp })}
                width={200}
              />
            </div>
            {f.op === 'isOneOf' ? (
              <>
                <span className="lf" style={{ display: 'flex', marginBottom: 8 }}>
                  <input
                    aria-label="Search values"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search values…"
                  />
                </span>
                <div style={{ maxHeight: 180, overflowY: 'auto', display: 'grid', gap: 2 }}>
                  {shownDistinct.map((v) => (
                    <label
                      key={v}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 13,
                        padding: '6px 4px',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={f.values.includes(v)}
                        onChange={() =>
                          onChange({
                            ...f,
                            values: f.values.includes(v) ? f.values.filter((x) => x !== v) : [...f.values, v],
                          })
                        }
                      />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {v}
                      </span>
                    </label>
                  ))}
                </div>
              </>
            ) : (
              <span className="lf" style={{ display: 'flex' }}>
                <input
                  aria-label="Filter value"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onChange({ ...f, value: draft });
                      setOpen(false);
                    }
                  }}
                  placeholder="Value…"
                  autoFocus
                />
              </span>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                type="button"
                onClick={() => {
                  onChange(undefined);
                  setOpen(false);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-muted)',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 13,
                  padding: '8px 10px',
                }}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange({ ...f, value: draft });
                  setOpen(false);
                }}
                style={{
                  background: 'var(--color-text)',
                  border: 'none',
                  borderRadius: 8,
                  color: 'var(--color-bg)',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 13,
                  fontWeight: 700,
                  padding: '8px 14px',
                }}
              >
                Apply
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
