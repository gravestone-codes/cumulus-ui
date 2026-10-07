/**
 * PeriodPicker: month calendar (+ hour grid for hours) choosing one period —
 * an hour, a day, or a run of days. With `lengthMs` the length is fixed and
 * a click only places the start (the "compare to" step). Local time; never
 * the native date input. Days and hours with no recorded data are disabled.
 */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { covered, dayStart, HOUR_MS, monthGrid, type Period, type PeriodKind } from '../lib/calendar.js';

const DAY_MS = 86_400_000;

export function PeriodPicker({
  kind,
  value,
  onChange,
  spans,
  max,
  lengthMs,
}: {
  kind: PeriodKind;
  value: Period | null;
  onChange: (p: Period) => void;
  /** Recorded stretches (sorted); only periods touching one are pickable. */
  spans: Period[];
  max: number;
  lengthMs?: number;
}) {
  const min = spans[0]?.from ?? max;
  const shown = new Date(value?.from ?? max - 1);
  const [view, setView] = useState({ y: shown.getFullYear(), m: shown.getMonth() });
  // Range baselines take two clicks; this holds the first day until the second.
  const [anchor, setAnchor] = useState<number | null>(null);
  // Follow the selection when it moves from outside (a quick pick in another month).
  const fromMs = value?.from;
  useEffect(() => {
    if (fromMs === undefined) return;
    const d = new Date(fromMs);
    setView({ y: d.getFullYear(), m: d.getMonth() });
  }, [fromMs]);

  const days = lengthMs !== undefined ? Math.max(1, Math.round(lengthMs / DAY_MS)) : 1;
  const hourAt = (day: number, h: number): Period => {
    const d = new Date(day);
    const from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime();
    return { from, to: from + HOUR_MS };
  };
  const fits = (p: Period) => p.from < max && covered(p, spans);

  function pickDay(day: number) {
    if (kind === 'hour') {
      // Keep the chosen hour when the new day allows it, else its first allowed hour.
      const keep = value ? new Date(value.from).getHours() : 0;
      const hours = Array.from({ length: 24 }, (_, h) => hourAt(day, h)).filter(fits);
      const pick = fits(hourAt(day, keep)) ? hourAt(day, keep) : hours[hours.length - 1];
      if (pick) onChange(pick);
      return;
    }
    if (kind === 'range' && lengthMs === undefined) {
      if (anchor === null) {
        setAnchor(day);
        onChange({ from: day, to: dayStart(day, 1) });
      } else {
        const [a, b] = day < anchor ? [day, anchor] : [anchor, day];
        setAnchor(null);
        onChange({ from: a, to: dayStart(b, 1) });
      }
      return;
    }
    onChange({ from: day, to: dayStart(day, days) });
  }

  const monthFirst = new Date(view.y, view.m, 1).getTime();
  const nextFirst = new Date(view.y, view.m + 1, 1).getTime();
  const today = dayStart(Date.now());
  const selDay = value ? dayStart(value.from) : null;
  const lastDay = value ? dayStart(value.to - 1) : null;
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }),
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <button
          type="button"
          aria-label="Previous month"
          disabled={monthFirst <= min}
          onClick={() => setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))}
          style={cell('plain', monthFirst <= min, { width: 32 })}
        >
          ‹
        </button>
        <span style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 600 }}>
          {new Date(monthFirst).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          aria-label="Next month"
          disabled={nextFirst >= max}
          onClick={() => setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))}
          style={cell('plain', nextFirst >= max, { width: 32 })}
        >
          ›
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {weekdays.map((w, i) => (
          <span
            key={i}
            style={{ textAlign: 'center', fontSize: 11, color: 'var(--color-muted)', paddingBottom: 4 }}
          >
            {w}
          </span>
        ))}
        {monthGrid(view.y, view.m).map((d) => {
          const day = d.getTime();
          const disabled = !fits({ from: day, to: dayStart(day, 1) });
          const edge = day === selDay || day === lastDay;
          const inside = selDay !== null && lastDay !== null && day > selDay && day < lastDay;
          return (
            <button
              key={day}
              type="button"
              aria-label={d.toLocaleDateString(undefined, { dateStyle: 'full' })}
              aria-pressed={edge || inside}
              disabled={disabled}
              onClick={() => pickDay(day)}
              style={cell(edge ? 'edge' : inside ? 'inside' : 'plain', disabled, {
                color: edge
                  ? 'var(--color-bg)'
                  : d.getMonth() === view.m
                    ? 'var(--color-text)'
                    : 'var(--color-muted)',
                borderColor: day === today && !edge ? 'var(--color-border)' : 'transparent',
              })}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
      {kind === 'range' && lengthMs === undefined && (
        <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '8px 0 0' }}>
          {anchor === null ? 'Click the first day, then the last.' : 'Now click the last day.'}
        </p>
      )}
      {kind === 'hour' && (
        <>
          <p
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--color-muted)',
              margin: '12px 0 6px',
            }}
          >
            Hour
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2 }}>
            {Array.from({ length: 24 }, (_, h) => {
              const p = selDay !== null ? hourAt(selDay, h) : null;
              const disabled = p === null || !fits(p);
              const selected = value !== null && new Date(value.from).getHours() === h;
              return (
                <button
                  key={h}
                  type="button"
                  aria-label={`${String(h).padStart(2, '0')}:00`}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => p && onChange(p)}
                  style={cell(selected ? 'edge' : 'plain', disabled)}
                >
                  {String(h).padStart(2, '0')}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Calendar/hour cell: ends of the selection solid, days between tinted. */
function cell(
  tone: 'plain' | 'edge' | 'inside',
  disabled: boolean,
  extra: CSSProperties = {},
): CSSProperties {
  return {
    height: 32,
    borderRadius: 8,
    border: '1px solid transparent',
    background:
      tone === 'edge' ? 'var(--color-brand)' : tone === 'inside' ? 'var(--color-surface-2)' : 'transparent',
    color: tone === 'edge' ? 'var(--color-bg)' : 'var(--color-text)',
    font: 'inherit',
    fontSize: 13,
    fontWeight: tone === 'edge' ? 700 : 400,
    fontVariantNumeric: 'tabular-nums',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.3 : 1,
    padding: 0,
    ...extra,
  };
}
