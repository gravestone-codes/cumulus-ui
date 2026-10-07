/**
 * Calendar math for the date/hour picker and period labels. Local time
 * throughout: people pick and read their own wall clock.
 */

export const HOUR_MS = 3_600_000;

/** Six Monday-first weeks covering the month (42 local midnights), padded with neighbour days. */
export function monthGrid(year: number, month: number): Date[] {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - lead + i));
}

/** Clock-hour floor of an instant (local; DST-safe). */
export function floorHour(ms: number): number {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Compact period label: "Oct 6", "Oct 6 – Oct 8", "Oct 6 14:00 – 15:00", "Oct 6 22:00 – Oct 7 02:00". */
export function spanLabel(from: number, to: number): string {
  const f = new Date(from);
  const t = new Date(to);
  const day = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const hm = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const midnight = (d: Date) => d.getHours() === 0 && d.getMinutes() === 0;
  if (midnight(f) && midnight(t)) {
    const last = new Date(to - 1);
    return sameDay(f, last) ? day(f) : `${day(f)} – ${day(last)}`;
  }
  return sameDay(f, t) ? `${day(f)} ${hm(f)} – ${hm(t)}` : `${day(f)} ${hm(f)} – ${day(t)} ${hm(t)}`;
}

/** A time period [from, to) in epoch ms. */
export interface Period {
  from: number;
  to: number;
}

/** Baseline shapes: one clock hour, one calendar day, or a run of whole days. */
export type PeriodKind = 'hour' | 'day' | 'range';

/** Local midnight starting the day `days` after the one holding `ms`. */
export function dayStart(ms: number, days = 0): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/** Whether a period shares time with [min, max). */
export function overlaps(p: Period, min: number, max: number): boolean {
  return p.from < max && p.to > min;
}

/** Whether any recorded span (sorted) shares time with the period. */
export function covered(p: Period, spans: Period[]): boolean {
  return spans.some((s) => overlaps(p, s.from, s.to));
}

/**
 * Starting baseline per kind: the last full hour, today, or the last seven
 * days — else the latest stretch that has data; null with no history.
 */
export function defaultPeriod(kind: PeriodKind, now: number, spans: Period[]): Period | null {
  const last = spans[spans.length - 1];
  const first = spans[0];
  if (!last || !first) return null;
  const hour = floorHour(now);
  const lastHour = floorHour(Math.min(last.to, now) - 1);
  const candidates: Period[] =
    kind === 'hour'
      ? [
          { from: hour - HOUR_MS, to: hour },
          { from: hour, to: hour + HOUR_MS },
          { from: lastHour, to: lastHour + HOUR_MS },
        ]
      : kind === 'day'
        ? [
            { from: dayStart(now), to: dayStart(now, 1) },
            { from: dayStart(lastHour), to: dayStart(lastHour, 1) },
          ]
        : [{ from: Math.max(dayStart(now, -6), dayStart(first.from)), to: dayStart(now, 1) }];
  return candidates.find((p) => covered(p, spans)) ?? null;
}
