/**
 * Danger classification (roadmap §6.6, locked): which confirm style a
 * destructive act needs. Routine → plain confirm; service-affecting → confirm
 * plus explicit acknowledgement; dangerous → typed confirmation. The dangerous
 * prefixes mirror the backend's DANGEROUS_PREFIXES (apps/api/src/rbac/store.ts)
 * — keep them in step; the server re-checks roles regardless.
 */

/** Confirm style for a destructive act. */
export type DangerClass = 'routine' | 'service' | 'dangerous';

/** Backend-canonical dangerous subtrees (mirrored — see header). */
const DANGEROUS_PREFIXES = [
  '/system/factory-default',
  '/system/image',
  '/system/packages',
  '/system/aaa',
  '/system/security',
];

/** Object deletes that carry traffic (conservative: any of these stops or shifts it). */
const SERVICE_PREFIXES = [
  '/interface',
  '/bridge',
  '/vrf',
  '/router',
  '/evpn',
  '/nve',
  '/mlag',
  '/acl',
  '/qos',
  '/service',
];

/** Danger class of deleting an NVUE object path. */
export function dangerOfDelete(path: string): DangerClass {
  if (DANGEROUS_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return 'dangerous';
  if (SERVICE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) return 'service';
  return 'routine';
}
