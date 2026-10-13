/**
 * Domain registry (M2++): every browsable NVUE namespace as data, not code.
 * The generic list/detail screens render any row from its collection path,
 * item template, default leaves and labels — zero per-domain components.
 * Deep slices (interfaces, bridge, BGP peers, …) keep bespoke screens and
 * stay OUT of this table; rows graduate out when their slice lands.
 */
import type { NavIcon } from '../components/ui.js';

export interface DomainDef {
  /** Route + nav key (e.g. `acl` → `/switches/:id/acl`). */
  key: string;
  /** Nav label. */
  label: string;
  icon: NavIcon;
  /** Collection read path (e.g. `/acl`). */
  collection: string;
  /** Item template for schemas and object paths (e.g. `/acl/{acl-id}`). */
  item: string;
  /** Single object per switch (no rows, no delete/create). */
  singleton?: boolean;
  /** Display name for a singleton row. */
  name?: string;
  /** Default picked leaf paths (persisted per table once the picker is touched). */
  fields: string[];
  /** Presentation label overrides by leaf path. */
  labels: Record<string, string>;
  /** Read revision (`applied` for config-only collections). */
  rev?: string;
  /** Hide the Edit tab + delete (read-only collections). */
  editable?: boolean;
  /** Show the New button (create via PATCH to a fresh path). */
  creatable?: boolean;
  /** Singular noun for buttons and titles (default: label minus trailing s). */
  singular?: string;
  /** Name prompt label for the create modal. */
  nameLabel?: string;
  /**
   * Container of sections (`/router` → bgp, ospf…; `/system` → syslog, ntp…):
   * a section index over one object instead of a table of rows.
   */
  sections?: boolean;
  /** Sections with their own deeper screen (section → domain key), linked from the section card. */
  sectionLinks?: Record<string, string>;
  /** Container this domain lives in (nav highlight + breadcrumb), e.g. DHCP → service. */
  parent?: string;
}

export const DOMAINS: DomainDef[] = [
  {
    key: 'vrf',
    label: 'VRFs',
    icon: 'vrfs',
    collection: '/vrf',
    item: '/vrf/{vrf-id}',
    fields: ['router/bgp/autonomous-system', 'router/bgp/router-id', 'evpn/enable', 'table'],
    labels: {
      'router/bgp/autonomous-system': 'BGP AS',
      'router/bgp/router-id': 'Router ID',
      'evpn/enable': 'EVPN',
      table: 'Table',
    },
    rev: 'applied',
    creatable: true,
    singular: 'VRF',
    nameLabel: 'VRF name',
  },
  {
    key: 'evpn',
    label: 'EVPN',
    icon: 'object',
    collection: '/evpn',
    item: '/evpn',
    singleton: true,
    name: 'evpn',
    fields: ['enable', 'dad/enable', 'route-advertise/default-gateway'],
    labels: { enable: 'Enabled', 'dad/enable': 'DAD', 'route-advertise/default-gateway': 'Default gateway' },
    rev: 'applied',
  },
  {
    key: 'mlag',
    label: 'MLAG',
    icon: 'object',
    collection: '/mlag',
    item: '/mlag',
    singleton: true,
    name: 'mlag',
    fields: ['enable', 'mac-address', 'priority', 'init-delay'],
    labels: { enable: 'Enabled', 'mac-address': 'MAC', priority: 'Priority', 'init-delay': 'Init delay' },
    rev: 'applied',
  },
  {
    key: 'router',
    label: 'Router',
    icon: 'bgp',
    collection: '/router',
    item: '/router',
    sections: true,
    fields: [],
    labels: {},
    rev: 'applied',
  },
  {
    key: 'service',
    label: 'Service',
    icon: 'object',
    collection: '/service',
    item: '/service',
    sections: true,
    sectionLinks: { 'dhcp-server': 'dhcp' },
    fields: [],
    labels: {},
    rev: 'applied',
  },
  {
    key: 'system',
    label: 'System',
    icon: 'software',
    collection: '/system',
    item: '/system',
    sections: true,
    sectionLinks: { syslog: 'syslog' },
    fields: [],
    labels: {},
    rev: 'applied',
  },
  {
    key: 'action',
    label: 'Actions',
    icon: 'object',
    collection: '/action',
    item: '/action/{action-job-id}',
    fields: ['type', 'state', 'status', 'percentage'],
    labels: { type: 'Type', state: 'State', status: 'Status', percentage: 'Progress' },
    editable: false,
    singular: 'Action',
  },
  {
    key: 'bgp',
    parent: 'router',
    label: 'BGP',
    icon: 'bgp',
    collection: '/router/bgp',
    item: '/router/bgp',
    singleton: true,
    name: 'bgp',
    fields: ['enable', 'autonomous-system', 'router-id'],
    labels: { enable: 'Enabled', 'autonomous-system': 'AS', 'router-id': 'Router ID' },
    rev: 'applied',
  },
  {
    key: 'acl',
    label: 'ACL',
    icon: 'object',
    collection: '/acl',
    item: '/acl/{acl-id}',
    fields: ['type'],
    labels: { type: 'Type' },
    rev: 'applied',
    creatable: true,
    singular: 'ACL',
    nameLabel: 'ACL name',
  },
  {
    key: 'qos',
    label: 'QoS',
    icon: 'object',
    collection: '/qos',
    item: '/qos',
    singleton: true,
    name: 'qos',
    fields: ['roce/enable', 'roce/mode'],
    labels: { 'roce/enable': 'RoCE', 'roce/mode': 'Mode' },
    rev: 'applied',
  },
  {
    key: 'dhcp',
    parent: 'service',
    label: 'DHCP',
    icon: 'object',
    collection: '/service/dhcp-server',
    item: '/service/dhcp-server/{vrf-id}',
    fields: ['domain-name'],
    labels: { 'domain-name': 'Domain' },
    rev: 'applied',
    creatable: true,
    singular: 'DHCP server',
    nameLabel: 'VRF',
  },
  {
    key: 'syslog',
    parent: 'system',
    label: 'Syslog',
    icon: 'object',
    collection: '/system/syslog/server',
    item: '/system/syslog/server/{server-id}',
    fields: ['port', 'protocol', 'vrf'],
    labels: { port: 'Port', protocol: 'Protocol', vrf: 'VRF' },
    rev: 'applied',
    creatable: true,
    singular: 'Syslog server',
    nameLabel: 'Server',
  },
  {
    key: 'platform',
    label: 'Platform',
    icon: 'object',
    collection: '/platform/inventory',
    item: '/platform/inventory/{inventory-id}',
    fields: [],
    labels: {},
    editable: false,
  },
  {
    key: 'nve',
    label: 'NVE',
    icon: 'object',
    collection: '/nve',
    item: '/nve',
    singleton: true,
    name: 'nve',
    fields: ['vxlan/enable', 'vxlan/port', 'vxlan/mtu'],
    labels: { 'vxlan/enable': 'VXLAN', 'vxlan/port': 'Port', 'vxlan/mtu': 'MTU' },
    rev: 'applied',
  },
  {
    key: 'maintenance',
    label: 'Maintenance',
    icon: 'object',
    collection: '/maintenance/unit',
    item: '/maintenance/unit/{unit-name}',
    fields: ['mode', 'interfaces', 'protocols'],
    labels: { mode: 'Mode', interfaces: 'Interfaces', protocols: 'Protocols' },
    rev: 'applied',
  },
];

/** Registry lookup by route key. */
export function domainOf(key: string): DomainDef | undefined {
  return DOMAINS.find((d) => d.key === key);
}

/** Breadcrumb step for a domain's container (Service › DHCP); none at top level. */
export function parentCrumb(def: DomainDef, base: string): Array<{ label: string; to: string }> {
  const parent = def.parent ? domainOf(def.parent) : undefined;
  return parent ? [{ label: parent.label, to: `${base}/${parent.key}` }] : [];
}

/** Singular noun for buttons and titles. */
export function singularOf(def: DomainDef): string {
  return def.singular ?? def.label.replace(/s$/, '');
}
