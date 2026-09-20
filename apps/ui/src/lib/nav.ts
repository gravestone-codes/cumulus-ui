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

/**
 * Global rail: always mounted, even with zero switches. Dashboard = fleet
 * at-a-glance, Switches = inventory, Groups = fan-out scopes, Settings =
 * this platform (users, roles, prefs). Switch controls live only under
 * /switches/:id — the URL namespaces keep platform and switch controls
 * unmixed by construction.
 */
export function globalNav(): Array<NavItem & { to: string }> {
  return [
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/switches', label: 'Switches', icon: 'switches' },
    { to: '/groups', label: 'Groups', icon: 'switches' },
    { to: '/settings', label: 'Settings', icon: 'software' },
  ];
}

/**
 * Group rail: the same domain items as a switch, applied to every member.
 * Domain entries stay disabled until fan-out reads land; the Overview names
 * the guardrail contract (per-switch-unique paths are refused group-wide).
 */
export function groupNav(groupId: string): Array<NavItem & { to: string }> {
  const base = `/groups/${groupId}`;
  return [
    { to: base, label: 'Overview', icon: 'dashboard' },
    { to: `${base}/interfaces`, label: 'Interfaces', icon: 'interfaces', disabled: true },
    { to: `${base}/vrfs`, label: 'VRFs', icon: 'vrfs', disabled: true },
    { to: `${base}/bgp`, label: 'BGP', icon: 'bgp', disabled: true },
    { to: `${base}/audit`, label: 'Audit Log', icon: 'audit', disabled: true },
  ];
}
