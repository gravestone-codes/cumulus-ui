/**
 * Shared navigation: the rail from final.html §9 — Dashboard, Interfaces,
 * Bridge, VRFs, BGP, Audit Log. One definition used by every switch-scoped screen.
 * Generic domains (registry) render enabled with the shared object icon;
 * a deep slice swaps in its bespoke screen and icon — one line.
 */
import type { NavItem } from '../components/ui.js';

/** Rail items for a switch. Active is the full path; compare in screens. */
export function switchNav(switchId: string): Array<NavItem & { to: string }> {
  const base = `/switches/${switchId}`;
  return [
    { to: base, label: 'Dashboard', icon: 'dashboard' },
    { to: `${base}/troubleshoot`, label: 'Troubleshoot', icon: 'troubleshoot' },
    { to: `${base}/config`, label: 'Config', icon: 'config' },
    { to: `${base}/interfaces`, label: 'Interfaces', icon: 'interfaces' },
    { to: `${base}/bridge`, label: 'Bridge', icon: 'bridge' },
    { to: `${base}/vrf`, label: 'VRFs', icon: 'vrfs' },
    { to: `${base}/evpn`, label: 'EVPN', icon: 'object' },
    { to: `${base}/mlag`, label: 'MLAG', icon: 'object' },
    { to: `${base}/bgp`, label: 'BGP', icon: 'bgp' },
    { to: `${base}/acl`, label: 'ACL', icon: 'object' },
    { to: `${base}/qos`, label: 'QoS', icon: 'object' },
    { to: `${base}/dhcp`, label: 'DHCP', icon: 'object' },
    { to: `${base}/syslog`, label: 'Syslog', icon: 'object' },
    { to: `${base}/platform`, label: 'Platform', icon: 'object' },
    { to: `${base}/nve`, label: 'NVE', icon: 'object' },
    { to: `${base}/maintenance`, label: 'Maintenance', icon: 'object' },
    { to: `${base}/audit`, label: 'Audit Log', icon: 'audit' },
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
 * Interfaces and Bridge read and write through FanOut; generic domains ride
 * the same fan-out through the registry screens.
 */
export function groupNav(groupId: string): Array<NavItem & { to: string }> {
  const base = `/groups/${groupId}`;
  return [
    { to: base, label: 'Overview', icon: 'dashboard' },
    { to: `${base}/interfaces`, label: 'Interfaces', icon: 'interfaces' },
    { to: `${base}/bridge`, label: 'Bridge', icon: 'bridge' },
    { to: `${base}/vrf`, label: 'VRFs', icon: 'vrfs' },
    { to: `${base}/evpn`, label: 'EVPN', icon: 'object' },
    { to: `${base}/mlag`, label: 'MLAG', icon: 'object' },
    { to: `${base}/bgp`, label: 'BGP', icon: 'bgp' },
    { to: `${base}/acl`, label: 'ACL', icon: 'object' },
    { to: `${base}/qos`, label: 'QoS', icon: 'object' },
    { to: `${base}/dhcp`, label: 'DHCP', icon: 'object' },
    { to: `${base}/syslog`, label: 'Syslog', icon: 'object' },
    { to: `${base}/platform`, label: 'Platform', icon: 'object' },
    { to: `${base}/nve`, label: 'NVE', icon: 'object' },
    { to: `${base}/maintenance`, label: 'Maintenance', icon: 'object' },
    { to: `${base}/audit`, label: 'Audit Log', icon: 'audit', disabled: true },
  ];
}
