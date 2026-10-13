import { useEffect, useRef, useState, type ReactNode } from 'react';

/** One slide's switch: id plus the display name the pager shows. */
export interface PagerSwitch {
  id: string;
  display_name?: string;
}

/** Pager over per-switch blocks: one switch per slide so cards stay fixed height as switches grow. */
export function SwitchPager({
  switches,
  failed,
  label,
  children,
}: {
  switches: PagerSwitch[];
  /** Ids that could not be read (shown as "· unreachable" in the heading). */
  failed: string[];
  /** Accessible name for the carousel region (e.g. "CPU per switch"). */
  label: string;
  children: (id: string, heading: string) => ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const touchX = useRef<number | null>(null);
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, switches.length - 1)));
  }, [switches.length]);
  if (switches.length === 0) return null;
  const current = switches[Math.min(index, switches.length - 1)]!;
  const heading = (s: PagerSwitch) =>
    switches.length === 1
      ? 'Utilization'
      : `${s.display_name || s.id}${failed.includes(s.id) ? ' · unreachable' : ''}`;
  if (switches.length === 1) return <>{children(current.id, heading(current))}</>;
  const go = (next: number) => setIndex((next + switches.length) % switches.length);
  const dots = switches.length <= 7;
  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(index - 1);
        else if (e.key === 'ArrowRight') go(index + 1);
      }}
      style={{ display: 'grid', gap: 10 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          aria-label={`Previous switch, currently ${current.display_name || current.id}`}
          title="Previous switch"
          onClick={() => go(index - 1)}
          style={navBtn}
        >
          ←
        </button>
        <select
          aria-label="Choose switch"
          value={current.id}
          onChange={(e) => {
            const at = switches.findIndex((s) => s.id === e.target.value);
            if (at >= 0) setIndex(at);
          }}
          style={select}
        >
          {switches.map((s) => (
            <option key={s.id} value={s.id}>
              {s.display_name || s.id}
              {failed.includes(s.id) ? ' · unreachable' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={`Next switch, currently ${current.display_name || current.id}`}
          title="Next switch"
          onClick={() => go(index + 1)}
          style={navBtn}
        >
          →
        </button>
        <span aria-live="polite" style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-muted)' }}>
          {index + 1} of {switches.length}
        </span>
      </div>
      {dots && (
        <div style={{ display: 'flex', gap: 6 }} role="tablist" aria-label="Switches">
          {switches.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`${s.display_name || s.id}${failed.includes(s.id) ? ', unreachable' : ''}`}
              title={s.display_name || s.id}
              onClick={() => setIndex(i)}
              style={{
                width: i === index ? 20 : 8,
                height: 8,
                borderRadius: 99,
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                background: i === index ? 'var(--color-brand)' : 'var(--color-border)',
              }}
            />
          ))}
        </div>
      )}
      <div
        onTouchStart={(e) => {
          touchX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          const start = touchX.current;
          touchX.current = null;
          if (start === null) return;
          const dx = (e.changedTouches[0]?.clientX ?? start) - start;
          if (dx > 40) go(index - 1);
          else if (dx < -40) go(index + 1);
        }}
      >
        {children(current.id, heading(current))}
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-grid',
  placeItems: 'center',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  color: 'var(--color-text)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 14,
};

const select: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  color: 'var(--color-text)',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  padding: '5px 8px',
};
