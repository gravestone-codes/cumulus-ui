/** Calendar math: month grid layout, hour flooring, period labels and defaults. */
import { describe, expect, it } from 'vitest';
import {
  covered,
  dayStart,
  defaultPeriod,
  floorHour,
  HOUR_MS,
  monthGrid,
  overlaps,
  spanLabel,
} from './calendar.js';

describe('monthGrid', () => {
  it('starts on the Monday on/before the 1st and spans six weeks', () => {
    const grid = monthGrid(2026, 9); // October 2026 starts on a Thursday
    expect(grid).toHaveLength(42);
    expect(grid[0]?.getDay()).toBe(1);
    expect([grid[0]?.getMonth(), grid[0]?.getDate()]).toEqual([8, 28]);
    expect(grid[3]?.getDate()).toBe(1);
  });
});

describe('floorHour', () => {
  it('drops minutes and below', () => {
    expect(floorHour(new Date(2026, 9, 7, 14, 37, 12).getTime())).toBe(new Date(2026, 9, 7, 14).getTime());
  });
});

describe('spanLabel', () => {
  const at = (d: number, h = 0) => new Date(2026, 9, d, h).getTime();
  it('names whole days by day only', () => {
    expect(spanLabel(at(6), at(7))).not.toMatch(/–|:/);
    expect(spanLabel(at(6), at(9))).toMatch(/–/);
    expect(spanLabel(at(6), at(9))).not.toMatch(/:/);
  });
  it('shows hours for partial days, the end day only when it differs', () => {
    const sameDay = spanLabel(at(6, 14), at(6, 15));
    expect(sameDay.split('–')[1]).not.toMatch(/Oct/);
    expect(spanLabel(at(6, 22), at(7, 2)).split('–')[1]).toMatch(/Oct/);
  });
});

describe('defaultPeriod', () => {
  const now = new Date(2026, 9, 7, 14, 30).getTime();
  const always = [{ from: new Date(2026, 0, 1).getTime(), to: now }];

  it('picks the last full hour, today, or the last seven days', () => {
    expect(defaultPeriod('hour', now, always)).toEqual({
      from: floorHour(now) - HOUR_MS,
      to: floorHour(now),
    });
    expect(defaultPeriod('day', now, always)).toEqual({ from: dayStart(now), to: dayStart(now, 1) });
    expect(defaultPeriod('range', now, always)).toEqual({ from: dayStart(now, -6), to: dayStart(now, 1) });
  });

  it('falls back to the latest recorded stretch, skipping gaps', () => {
    // Recording stopped three hours ago: the last recorded hour, not an empty one.
    const stopped = [{ from: now - 10 * HOUR_MS, to: floorHour(now) - 2 * HOUR_MS }];
    expect(defaultPeriod('hour', now, stopped)?.from).toBe(floorHour(now) - 3 * HOUR_MS);
    expect(defaultPeriod('hour', now, [])).toBeNull();
  });
});

describe('covered', () => {
  it('needs overlap with some recorded span', () => {
    const spans = [
      { from: 0, to: 10 },
      { from: 20, to: 30 },
    ];
    expect(covered({ from: 12, to: 18 }, spans)).toBe(false);
    expect(covered({ from: 25, to: 40 }, spans)).toBe(true);
  });
});

describe('overlaps', () => {
  it('needs some shared time, not just a touching edge', () => {
    expect(overlaps({ from: 0, to: 10 }, 5, 20)).toBe(true);
    expect(overlaps({ from: 0, to: 5 }, 5, 20)).toBe(false);
    expect(overlaps({ from: 20, to: 30 }, 5, 20)).toBe(false);
  });
});
