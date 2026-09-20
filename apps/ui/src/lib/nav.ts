/**
 * Shared navigation: the rail from final.html §9 — Dashboard, Interfaces,
 * VRFs, BGP, Audit Log. One definition used by every switch-scoped screen.
 * Unsliced domains render disabled until their slice lands (roadmap order);
 * a slice deletes its `disabled` flag and adds its route — one line.
 */
import type { NavItem } from '../components/ui.js';

/** Rail items for a switch. Active is the full path; compare in screens. */
export function switchNav(switchId: string): Array<NavItem & { to: string }> {
  const base = `/switches/${switchId}`;
  return [
    { to: base, label: 'Dashboard', icon: 'dashboard' },
    { to: `${base}/interfaces`, label: 'Interfaces', icon: 'interfaces' },
    { to: `${base}/vrfs`, label: 'VRFs', icon: 'vrfs', disabled: true },
    { to: `${base}/bgp`, label: 'BGP', icon: 'bgp', disabled: true },
    { to: `${base}/audit`, label: 'Audit Log', icon: 'audit', disabled: true },
  ];
}
