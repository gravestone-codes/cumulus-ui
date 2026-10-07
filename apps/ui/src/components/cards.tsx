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
