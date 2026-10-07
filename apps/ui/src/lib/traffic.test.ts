/**
 * Traffic math unit tests: seed/live merge and the start-on-start
 * comparison overlay.
 */
import { describe, expect, it } from 'vitest';
import {
  mergeSamples,
  overlayCompare,
  type TrafficSample,
  perSwitchRows,
  samplesToRates,
  sumSeries,
} from './traffic.js';

const s = (t: number, inB = t): TrafficSample => ({ t, inB, outB: inB });

describe('mergeSamples', () => {
  it('orders, dedupes by timestamp, and trims to the window', () => {
    const merged = mergeSamples([s(60), s(120)], [s(10), s(120, 999), s(125)], 50);
    expect(merged.map((m) => m.t)).toEqual([60, 120, 125]);
    expect(merged[1]?.inB).toBe(999);
  });
});

describe('overlayCompare', () => {
  const DAY = 86_400_000;
  const base = [
    { t: 10 * DAY, In: 1, Out: 2 },
    { t: 10 * DAY + 60_000, In: 3, Out: 4 },
  ];

  it('moves the comparison period onto the base start', () => {
    const cmp = [
      { t: 3 * DAY, In: 5, Out: 6 },
      { t: 3 * DAY + 60_000, In: 7, Out: 8 },
    ];
    expect(overlayCompare(base, cmp, 7 * DAY)).toEqual([
      { t: 10 * DAY, In: 1, Out: 2, InB: 5, OutB: 6 },
      { t: 10 * DAY + 60_000, In: 3, Out: 4, InB: 7, OutB: 8 },
    ]);
  });

  it('keeps each resolution and a longer comparison runs past the base end', () => {
    const cmp = [
      { t: 3 * DAY + 30_000, In: 5, Out: 5 },
      { t: 3 * DAY + 3_600_000, In: 9, Out: 9 },
    ];
    expect(overlayCompare(base, cmp, 7 * DAY).map((p) => [p.t - 10 * DAY, p.In, p.InB])).toEqual([
      [0, 1, undefined],
      [30_000, undefined, 5],
      [60_000, 3, undefined],
      [3_600_000, undefined, 9],
    ]);
  });

  it('passes base through with no comparison data', () => {
    expect(overlayCompare(base, [], DAY)).toEqual(base);
  });
});

describe('group series', () => {
  const s = (t: number, inB: number, outB: number) => ({ t, inB, outB });
  it('rates from counters (bytes → bits), resets dropped', () => {
    expect(samplesToRates([s(0, 0, 0), s(1000, 100, 50), s(2000, 10, 60)], 'bytes')).toEqual([
      { t: 1000, in: 800, out: 400 },
    ]);
  });
  it('sums visible switches per bucket, only where every visible switch reported', () => {
    const series = {
      a: [
        { t: 10_000, in: 1, out: 2 },
        { t: 20_000, in: 1, out: 2 },
      ],
      b: [{ t: 11_000, in: 10, out: 20 }],
    };
    expect(sumSeries(series, ['a', 'b'], 10_000)).toEqual([{ t: 10_000, In: 11, Out: 22 }]);
    expect(sumSeries(series, ['a'], 10_000)).toEqual([
      { t: 10_000, In: 1, Out: 2 },
      { t: 20_000, In: 1, Out: 2 },
    ]);
    expect(perSwitchRows(series, ['a', 'b'], 'out', 10_000)).toEqual([
      { t: 10_000, a: 2, b: 20 },
      { t: 20_000, a: 2 },
    ]);
  });
});
