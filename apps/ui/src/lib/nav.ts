/**
 * Shared navigation: one definition of the rail, used by every switch-scoped
 * screen. New domain slices add one line here — no per-screen copies.
 */
import type { NavItem } from '../components/ui.js';

/** Rail items for a switch. Active is the full path; compare in screens. */
export function switchNav(switchId: string): Array<NavItem & { to: string }> {
  const base = `/switches/${switchId}`;
  return [
    { to: base, label: 'Overview' },
    { to: `${base}/interfaces`, label: 'Interfaces' },
  ];
}
