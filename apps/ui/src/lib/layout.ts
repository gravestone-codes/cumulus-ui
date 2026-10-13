/** Dashboard layout edits, pure so drag-and-drop and arrow moves share one tested rule. */

/** Move `from` onto `to`'s slot: after it when moving forward, before it when moving back. */
export function moveWidget(ids: string[], from: string, to: string): string[] {
  const fi = ids.indexOf(from);
  const ti = ids.indexOf(to);
  if (fi < 0 || ti < 0 || fi === ti) return ids;
  const next = ids.filter((x) => x !== from);
  const at = next.indexOf(to);
  next.splice(fi < ti ? at + 1 : at, 0, from);
  return next;
}
