import type { ReactNode } from 'react';
import { Hint } from './ui.js';
/**
 * Shared dashboard cards (fleet + switch scopes): minimal, quiet, modern.
 * Card shell with neutral SAMPLE marker and remove slot; Stat tile with
 * tabular numerals; StatRow lays tiles in a divided row; packets() compacts
 * counters. One definition — dashboards compose, never copy.
 */

export function SampleBadge() {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--color-muted)',
        border: '1px solid var(--color-border)',
        borderRadius: 5,
        padding: '2px 6px',
        marginLeft: 8,
        verticalAlign: 'middle',
      }}
    >
      Sample
    </span>
  );
}

export function Card({
  title,
  info,
  hint,
  sample,
  onRemove,
  actions,
  children,
}: {
  title: string;
  /** What the card shows, behind a (?) tooltip next to the title. */
  info?: string;
  hint?: string;
  sample?: boolean;
  onRemove?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        padding: 16,
        minWidth: 0,
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 2px', flex: 1 }}>
          {title}
          {info && <Hint text={info} />}
          {sample && <SampleBadge />}
        </h3>
        {actions}
      </div>
      {hint && <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '0 0 12px' }}>{hint}</p>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          title={`Remove ${title}`}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            background: 'transparent',
            border: 'none',
            color: 'var(--color-muted)',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 16,
            padding: 4,
          }}
        >
          ×
        </button>
      )}
      <CardBody>{children}</CardBody>
    </section>
  );
}

function CardBody({ children }: { children: ReactNode }) {
  return <div style={{ marginTop: 16 }}>{children}</div>;
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <p
        title={label}
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--color-muted)',
          margin: '0 0 6px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: value.length > 6 ? 22 : 30,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          margin: 0,
          color: tone ?? 'var(--color-text)',
        }}
      >
        {value}
      </p>
      {sub && (
        <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '2px 0 0', whiteSpace: 'nowrap' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/* StatRow: tiles in a divided row. The hairline rule is unconditional: EVERY
   tile carries its left divider, including the first — no exceptions, so the
   look cannot regress by layout. Fixed column count (no wrap orphans). */
export function StatRow({ children, columns }: { children: ReactNode[]; columns?: number }) {
  const tiles = Array.isArray(children) ? children : [children];
  const n = columns ?? 0;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: n > 0 ? `repeat(${n}, minmax(0, 1fr))` : 'repeat(auto-fit, minmax(110px, 1fr))',
        columnGap: 0,
        rowGap: 20,
      }}
    >
      {tiles.map((tile, i) => (
        <div
          key={i}
          style={{
            padding: '2px 16px 2px 0',
            borderLeft: '1px solid var(--color-border)',
            paddingLeft: 16,
          }}
        >
          {tile}
        </div>
      ))}
    </div>
  );
}

/** Compact packet/counter formatting: 1500 -> 1.5k, 2.4e9 -> 2.4G. */
export function packets(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}G`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

/** Meter: a labelled 0–100% bar; warn past 80, fail past 90 (utilization reads). */
export function Meter({ label, value }: { label: string; value: number | undefined }) {
  const pct = value === undefined ? 0 : Math.max(0, Math.min(100, value));
  const tone =
    value === undefined
      ? 'var(--color-border)'
      : pct > 90
        ? 'var(--color-fail)'
        : pct > 80
          ? 'var(--color-warn)'
          : 'var(--color-pass)';
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '38px minmax(0, 1fr) 44px',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>{label}</span>
      <span
        role="meter"
        aria-label={label}
        aria-valuenow={value === undefined ? undefined : Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ height: 6, borderRadius: 99, background: 'var(--color-surface-2)', overflow: 'hidden' }}
      >
        <span
          style={{ display: 'block', height: '100%', width: `${pct}%`, background: tone, borderRadius: 99 }}
        />
      </span>
      <span style={{ fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {value === undefined ? '—' : `${Math.round(pct)}%`}
      </span>
    </div>
  );
}

/** StackBar: proportional segments (e.g. ports up/down/admin-down) in one row. */
export function StackBar({ parts }: { parts: Array<{ label: string; value: number; color: string }> }) {
  const total = parts.reduce((n, p) => n + p.value, 0);
  return (
    <span
      role="img"
      aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}
      style={{
        display: 'flex',
        height: 8,
        borderRadius: 99,
        overflow: 'hidden',
        background: 'var(--color-surface-2)',
        gap: total > 0 ? 2 : 0,
      }}
    >
      {total > 0 &&
        parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span
              key={p.label}
              style={{ flex: p.value, background: p.color }}
              title={`${p.label}: ${p.value}`}
            />
          ))}
    </span>
  );
}

/** Legend: colour dot + label + count, wraps on narrow cards. */
export function Legend({
  items,
}: {
  items: Array<{ label: string; value?: number | string; color: string }>;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 14px',
        fontSize: 12,
        color: 'var(--color-muted)',
      }}
    >
      {items.map((i) => (
        <span key={i.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: i.color }} />
          {i.label}
          {i.value !== undefined && (
            <strong style={{ color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
              {i.value}
            </strong>
          )}
        </span>
      ))}
    </div>
  );
}

/** Byte totals: 1536 → 1.5 KB, binary steps, one decimal. */
export function bytes(v: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let n = v;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** MiniTable: compact read-only rows inside a card (top-N lists); rows may link. */
export function MiniTable<T>({
  cols,
  rows,
  rowKey,
  onRow,
}: {
  cols: Array<{ label: string; align?: 'right'; cell: (row: T) => ReactNode }>;
  rows: T[];
  rowKey: (row: T) => string;
  onRow?: (row: T) => void;
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c.label}
                style={{
                  textAlign: c.align ?? 'left',
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--color-muted)',
                  padding: '0 8px 8px 0',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRow ? () => onRow(r) : undefined}
              style={onRow ? { cursor: 'pointer' } : undefined}
            >
              {cols.map((c) => (
                <td
                  key={c.label}
                  style={{
                    textAlign: c.align ?? 'left',
                    padding: '7px 8px 7px 0',
                    borderTop: '1px solid var(--color-border)',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                    maxWidth: 220,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Muted one-liner for card empty/loading states. */
export function Quiet({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>{children}</p>;
}
