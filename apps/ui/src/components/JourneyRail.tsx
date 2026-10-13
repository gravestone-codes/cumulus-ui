/**
 * JourneyRail: a journey's steps in order with where each stands. Status is
 * said in words beside the marker (never colour alone); the current step is
 * `aria-current`. Rows open finished steps for review via `onPick`.
 */
import type { RailStatus } from '../lib/journeys.js';

const MARK: Record<RailStatus, { glyph: string; color: string; word: string }> = {
  done: { glyph: '✓', color: 'var(--color-pass)', word: 'Done' },
  skipped: { glyph: '–', color: 'var(--color-muted)', word: 'Skipped' },
  blocked: { glyph: '!', color: 'var(--color-fail)', word: 'Blocked' },
  branched: { glyph: '↳', color: 'var(--color-warn)', word: 'Decided' },
  current: { glyph: '●', color: 'var(--color-brand)', word: 'Now' },
  pending: { glyph: '○', color: 'var(--color-muted)', word: '' },
};

export function JourneyRail({
  steps,
  selected,
  onPick,
}: {
  steps: Array<{ id: string; title: string; status: RailStatus }>;
  /** Step shown in the panel (defaults to the current one). */
  selected?: string;
  onPick?: (id: string) => void;
}) {
  return (
    <ol
      aria-label="Journey steps"
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}
    >
      {steps.map((s, i) => {
        const m = MARK[s.status];
        const reviewable = s.status !== 'pending' && onPick !== undefined;
        return (
          <li key={s.id}>
            <button
              type="button"
              className="index-link"
              disabled={!reviewable}
              aria-current={s.status === 'current' || s.status === 'blocked' ? 'step' : undefined}
              aria-pressed={selected === s.id}
              onClick={() => onPick?.(s.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '18px minmax(0, 1fr) auto',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                textAlign: 'left',
                cursor: reviewable ? 'pointer' : 'default',
                fontWeight: selected === s.id ? 700 : undefined,
                color: s.status === 'pending' ? 'var(--color-muted)' : undefined,
              }}
            >
              <span aria-hidden style={{ color: m.color, fontWeight: 700, textAlign: 'center' }}>
                {m.glyph}
              </span>
              <span
                style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {i + 1}. {s.title}
              </span>
              <span style={{ fontSize: 11, color: m.color }}>{m.word}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
