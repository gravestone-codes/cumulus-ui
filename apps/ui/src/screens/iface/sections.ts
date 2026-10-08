/**
 * Interface config sections (roadmap 3A; design/interfaces.html §8B, §10).
 * Which spec subtrees appear as Config cards and with what labels is
 * presentation, so it lives here; every option, bound and value still comes
 * from the backend (spec schema + live reads). Domain-owned areas (bridge,
 * VRR/VRRP, routing, QoS, ACL, PTP) join with their slices (§9A).
 */
import type { FieldKind } from '../../lib/fieldSchema.js';

export interface FieldDef {
  /** Leaf path under the section base (`mtu`, `bw-gauge/enable`). */
  leaf: string;
  label: string;
  /** Kind override for leaves read without a schema (base ''). */
  kind?: FieldKind;
  /** One value can't be right on every switch (IPs, MACs): group edits take one value per member. */
  perSwitch?: boolean;
  /** Choices come from this NVUE collection's keys on each switch (e.g. `/vrf`), not the spec. */
  optionsFrom?: string;
}

export interface ReadOnlyDef {
  /** Leaf path from the object root in the operational object. */
  leaf: string;
  label: string;
  /** Naturally different on every switch (MACs): locked marker in groups. */
  perSwitch?: boolean;
}

export interface SectionDef {
  id: string;
  title: string;
  /** Subtree under the object path; '' = the object root. */
  base: string;
  fields: FieldDef[];
  /** Live (operational) values shown in the card but not edited here. */
  status?: ReadOnlyDef[];
  /** Interface types the section applies to; omitted = every type. */
  types?: string[];
  /** Shown first and always listed as configured (identity sections). */
  pinned?: boolean;
}

const PORTS = ['swp', 'eth', 'bond', 'sub'];

export const SECTIONS: SectionDef[] = [
  {
    id: 'general',
    title: 'General',
    base: '',
    pinned: true,
    fields: [{ leaf: 'description', label: 'Description', kind: 'text' }],
    status: [{ leaf: 'type', label: 'Type' }],
  },
  {
    id: 'link',
    title: 'Link',
    base: 'link',
    pinned: true,
    types: PORTS,
    fields: [
      { leaf: 'state', label: 'Admin state' },
      { leaf: 'mtu', label: 'MTU' },
      { leaf: 'speed', label: 'Speed' },
      { leaf: 'auto-negotiate', label: 'Auto-negotiate' },
      { leaf: 'duplex', label: 'Duplex' },
      { leaf: 'fec', label: 'FEC' },
      { leaf: 'lanes', label: 'Lanes' },
      { leaf: 'fast-linkup', label: 'Fast link-up' },
      { leaf: 'mac-address', label: 'MAC override', perSwitch: true },
    ],
    status: [
      { leaf: 'link/oper-status', label: 'Oper status' },
      { leaf: 'link/speed', label: 'Running speed' },
      { leaf: 'link/mac-address', label: 'MAC address', perSwitch: true },
    ],
  },
  {
    id: 'breakout',
    title: 'Breakout',
    base: 'link',
    types: ['swp'],
    fields: [{ leaf: 'breakout', label: 'Breakout mode' }],
  },
  {
    id: 'flap',
    title: 'Flap protection',
    base: 'link/flap-protection',
    types: ['swp'],
    fields: [{ leaf: 'enable', label: 'Enabled' }],
  },
  {
    id: 'ip',
    title: 'IP · VRF',
    base: 'ip',
    fields: [
      { leaf: 'vrf', label: 'VRF', optionsFrom: '/vrf' },
      { leaf: 'address', label: 'Addresses', perSwitch: true },
      { leaf: 'gateway', label: 'Gateways', perSwitch: true },
    ],
  },
  {
    id: 'bond',
    title: 'Bond',
    base: 'bond',
    types: ['bond'],
    fields: [
      { leaf: 'member', label: 'Members' },
      { leaf: 'mode', label: 'Mode' },
      { leaf: 'lacp-rate', label: 'LACP rate' },
      { leaf: 'lacp-bypass', label: 'LACP bypass' },
      { leaf: 'up-delay', label: 'Up delay (ms)' },
      { leaf: 'down-delay', label: 'Down delay (ms)' },
    ],
  },
  {
    id: 'lldp',
    title: 'LLDP',
    base: 'lldp',
    types: ['swp', 'eth', 'bond'],
    fields: [
      { leaf: 'state', label: 'State' },
      { leaf: 'dcbx-pfc-tlv', label: 'DCBX PFC TLV' },
      { leaf: 'dcbx-ets-config-tlv', label: 'DCBX ETS config TLV' },
      { leaf: 'dcbx-ets-recomm-tlv', label: 'DCBX ETS recommend TLV' },
    ],
  },
  {
    id: 'storm',
    title: 'Storm control',
    base: 'storm-control',
    types: ['swp'],
    fields: [
      { leaf: 'broadcast', label: 'Broadcast (pps)' },
      { leaf: 'multicast', label: 'Multicast (pps)' },
      { leaf: 'unknown-unicast', label: 'Unknown unicast (pps)' },
    ],
  },
  {
    id: 'port-security',
    title: 'Port security',
    base: 'port-security',
    types: ['swp', 'bond'],
    fields: [
      { leaf: 'enable', label: 'Enabled' },
      { leaf: 'mac-limit', label: 'MAC limit' },
      { leaf: 'sticky-mac', label: 'Sticky MAC' },
      { leaf: 'sticky-timeout', label: 'Sticky timeout (s)' },
      { leaf: 'sticky-ageing', label: 'Sticky ageing' },
      { leaf: 'violation-mode', label: 'Violation mode' },
      { leaf: 'violation-timeout', label: 'Violation timeout (min)' },
    ],
  },
  {
    id: 'dot1x',
    title: '802.1X',
    base: 'dot1x',
    types: ['swp'],
    fields: [
      { leaf: 'eap', label: 'EAP' },
      { leaf: 'mba', label: 'MAC bypass (MBA)' },
      { leaf: 'auth-fail-vlan', label: 'Auth-fail VLAN' },
      { leaf: 'host-mode', label: 'Host mode' },
    ],
  },
  {
    id: 'sflow',
    title: 'sFlow',
    base: 'sflow',
    types: ['swp', 'eth', 'bond'],
    fields: [
      { leaf: 'state', label: 'State' },
      { leaf: 'sample-rate', label: 'Sample rate' },
    ],
  },
  {
    id: 'telemetry',
    title: 'Telemetry',
    base: 'telemetry',
    types: ['swp'],
    fields: [
      { leaf: 'bw-gauge/enable', label: 'Bandwidth gauge' },
      { leaf: 'label', label: 'Labels' },
    ],
  },
];

/** Full leaf path from the object root. */
export const fieldPath = (s: SectionDef, f: FieldDef) => (s.base ? `${s.base}/${f.leaf}` : f.leaf);

/** Values that read as "not configured" (feature defaults off). */
const IDLE = new Set(['', 'off', 'disabled', '0']);

/** A section counts as configured when any field holds a non-idle value. */
export function isConfigured(values: string[]): boolean {
  return values.some((v) => !IDLE.has(v));
}

/** Sections for an interface type (unknown type → all). */
export function sectionsFor(type: string | undefined): SectionDef[] {
  return SECTIONS.filter((s) => !s.types || !type || s.types.includes(type));
}
