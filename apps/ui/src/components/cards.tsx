import type { ReactNode } from 'react';
/**
 * Shared dashboard cards (fleet + switch scopes): Card shell with SAMPLE
 * badge and remove slot, Stat tile, EmptyChart placeholder. One definition —
 * dashboards compose, never copy.
 */

export function SampleBadge() {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--color-warn)',
        border: '1px solid var(--color-warn)',
        borderRadius: 6,
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
  hint,
  sample,
  onRemove,
  children,
}: {
  title: string;
  hint?: string;
  sample?: boolean;
  onRemove?: () => void;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 16,
        padding: 20,
        minWidth: 0,
        position: 'relative',
      }}
    >
      <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 2px' }}>
        {title}
        {sample && <SampleBadge />}
      </h3>
      {hint && <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '0 0 16px' }}>{hint}</p>}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${title}`}
          title={`Remove ${title}`}
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
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
      {children}
    </section>
  );
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
    <div style={{ minWidth: 120 }}>
      <p
        style={{
          fontSize: 12,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-muted)',
          margin: '0 0 8px',
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          margin: 0,
          color: tone ?? 'var(--color-text)',
        }}
      >
        {value}
      </p>
      {sub && <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '4px 0 0' }}>{sub}</p>}
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
