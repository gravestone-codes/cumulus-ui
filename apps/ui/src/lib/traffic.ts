/**
 * Traffic graph math kept pure for tests: merging server-seeded and live
 * counter readings, and overlaying a comparison period onto the base one.
 */

/** One cumulative counter reading (epoch ms). Server seed and live ticks share this shape. */
export interface TrafficSample {
  t: number;
  inB: number;
  outB: number;
  inP?: number;
  outP?: number;
  dr?: number;
  er?: number;
}

/** Union of readings ordered by time, one per timestamp, trimmed to `since`. */
export function mergeSamples(a: TrafficSample[], b: TrafficSample[], since: number): TrafficSample[] {
  const byT = new Map<number, TrafficSample>();
  for (const s of [...a, ...b]) if (s.t >= since) byT.set(s.t, s);
  return [...byT.values()].sort((x, y) => x.t - y.t);
}

/** A graph row: base rates and/or comparison rates at one instant (absent keys are gaps). */
export interface OverlayPoint {
  t: number;
  In?: number;
  Out?: number;
  InB?: number;
  OutB?: number;
}

/**
 * Lay a comparison period over the base one, start on start: comparison
 * points move forward by `offsetMs` (base start − comparison start) and join
 * the base rows on one time axis. Each series keeps its own resolution.
 */
export function overlayCompare(
  base: Array<{ t: number; In: number; Out: number }>,
  cmp: Array<{ t: number; In: number; Out: number }>,
  offsetMs: number,
): OverlayPoint[] {
  const byT = new Map<number, OverlayPoint>();
  for (const p of base) byT.set(p.t, { t: p.t, In: p.In, Out: p.Out });
  for (const p of cmp) {
    const t = p.t + offsetMs;
    byT.set(t, { ...(byT.get(t) ?? { t }), InB: p.In, OutB: p.Out });
  }
  return [...byT.values()].sort((x, y) => x.t - y.t);
}

/** A rate point (per second): bits or packets, in and out. */
export interface RatePoint {
  t: number;
  in: number;
  out: number;
}

/** Rates between consecutive readings; counter resets and gaps drop out. Bytes become bits. */
export function samplesToRates(samples: TrafficSample[], metric: 'bytes' | 'packets'): RatePoint[] {
  const pts: RatePoint[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b) continue;
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) continue;
    const pair =
      metric === 'packets'
        ? a.inP === undefined || b.inP === undefined || a.outP === undefined || b.outP === undefined
          ? null
          : [b.inP - a.inP, b.outP - a.outP]
        : [(b.inB - a.inB) * 8, (b.outB - a.outB) * 8];
    if (!pair || pair[0]! < 0 || pair[1]! < 0) continue;
    pts.push({ t: b.t, in: pair[0]! / dt, out: pair[1]! / dt });
  }
  return pts;
}

const bucketOf = (t: number, step: number) => Math.round(t / step) * step;

/**
 * Group sum over the visible switches, bucketed so members sampled seconds
 * apart add up on one instant. A bucket only counts once every visible
 * switch has a point there — partial sums would read as traffic dips.
 */
export function sumSeries(
  series: Record<string, RatePoint[]>,
  visible: string[],
  stepMs: number,
): Array<{ t: number; In: number; Out: number }> {
  const acc = new Map<number, { in: number; out: number; n: Set<string> }>();
  for (const sw of visible) {
    for (const p of series[sw] ?? []) {
      const t = bucketOf(p.t, stepMs);
      const cur = acc.get(t) ?? { in: 0, out: 0, n: new Set<string>() };
      if (cur.n.has(sw)) continue;
      cur.in += p.in;
      cur.out += p.out;
      cur.n.add(sw);
      acc.set(t, cur);
    }
  }
  const withData = visible.filter((sw) => (series[sw]?.length ?? 0) > 0);
  return [...acc.entries()]
    .filter(([, v]) => withData.every((sw) => v.n.has(sw)))
    .sort(([a], [b]) => a - b)
    .map(([t, v]) => ({ t, In: v.in, Out: v.out }));
}

/** One row per bucket with each visible switch's rate in one direction (per-switch lines). */
export function perSwitchRows(
  series: Record<string, RatePoint[]>,
  visible: string[],
  dir: 'in' | 'out',
  stepMs: number,
): Array<Record<string, number>> {
  const rows = new Map<number, Record<string, number>>();
  for (const sw of visible) {
    for (const p of series[sw] ?? []) {
      const t = bucketOf(p.t, stepMs);
      const row = rows.get(t) ?? { t };
      if (row[sw] === undefined) row[sw] = p[dir];
      rows.set(t, row);
    }
  }
  return [...rows.values()].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
}
