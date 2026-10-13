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
  /** The collection rejects `?include` (NVUE answers 404): read whole, pick columns client-side. */
  noInclude?: boolean;
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
    sectionLinks: {
      'dhcp-server': 'dhcp',
      ntp: 'ntp',
      dns: 'dns',
      'dhcp-relay': 'dhcp-relay',
      'dhcp-relay6': 'dhcp-relay6',
      'dhcp-server6': 'dhcp-server6',
      ptp: 'ptp',
      control: 'control',
    },
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
    sectionLinks: {
      syslog: 'syslog',
      'snmp-server': 'snmp',
      ztp: 'ztp',
      'port-mirror': 'port-mirror',
      'grpc-tunnel': 'grpc-tunnel',
      wjh: 'wjh-channel',
    },
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
    fields: ['state', 'status'],
    labels: { state: 'State', status: 'Status', percentage: 'Progress' },
    editable: false,
    noInclude: true,
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
    key: 'ntp',
    parent: 'service',
    label: 'NTP',
    icon: 'object',
    collection: '/service/ntp',
    item: '/service/ntp/{vrf-id}',
    fields: [],
    labels: {},
    rev: 'applied',
    creatable: true,
    singular: 'NTP instance',
    nameLabel: 'VRF',
  },
  {
    key: 'dns',
    parent: 'service',
    label: 'DNS',
    icon: 'object',
    collection: '/service/dns',
    item: '/service/dns/{vrf-id}',
    fields: [],
    labels: {},
    rev: 'applied',
    creatable: true,
    singular: 'DNS instance',
    nameLabel: 'VRF',
  },
  {
    key: 'dhcp-relay',
    parent: 'service',
    label: 'DHCP relay',
    icon: 'object',
    collection: '/service/dhcp-relay',
    item: '/service/dhcp-relay/{vrf-id}',
    fields: ['source-ip', 'agent/state'],
    labels: {},
    rev: 'applied',
    creatable: true,
    singular: 'DHCP relay',
    nameLabel: 'VRF',
  },
  {
    key: 'dhcp-relay6',
    parent: 'service',
    label: 'DHCP relay6',
    icon: 'object',
    collection: '/service/dhcp-relay6',
    item: '/service/dhcp-relay6/{vrf-id}',
    fields: [],
    labels: {},
    rev: 'applied',
    creatable: true,
    singular: 'DHCPv6 relay',
    nameLabel: 'VRF',
  },
  {
    key: 'dhcp-server6',
    parent: 'service',
    label: 'DHCPv6 server',
    icon: 'object',
    collection: '/service/dhcp-server6',
    item: '/service/dhcp-server6/{vrf-id}',
    fields: ['domain-name'],
    labels: { 'domain-name': 'Domain' },
    rev: 'applied',
    creatable: true,
    singular: 'DHCPv6 server',
    nameLabel: 'VRF',
  },
  {
    key: 'ptp',
    parent: 'service',
    label: 'PTP',
    icon: 'object',
    collection: '/service/ptp',
    item: '/service/ptp/{instance-id}',
    fields: ['current-profile', 'domain', 'priority1', 'priority2'],
    labels: {},
    rev: 'applied',
    creatable: true,
    singular: 'PTP instance',
    nameLabel: 'Instance',
  },
  {
    key: 'control',
    parent: 'service',
    label: 'Service control',
    icon: 'object',
    collection: '/service/control',
    item: '/service/control/{service-name-id}',
    fields: ['resource-limit/memory', 'resource-limit/cpu'],
    labels: {},
    rev: 'applied',
    singular: 'Service control',
    nameLabel: 'Service',
  },
  {
    key: 'port-mirror',
    parent: 'system',
    label: 'Port mirror',
    icon: 'object',
    collection: '/system/port-mirror/session',
    item: '/system/port-mirror/session/{session-id}',
    fields: ['span/direction', 'erspan/direction'],
    labels: {},
    rev: 'applied',
    creatable: true,
    singular: 'Port mirror session',
    nameLabel: 'Session',
  },
  {
    key: 'grpc-tunnel',
    parent: 'system',
    label: 'GRPC tunnel',
    icon: 'object',
    collection: '/system/grpc-tunnel/server',
    item: '/system/grpc-tunnel/server/{server-name-id}',
    fields: ['target-name', 'address', 'port'],
    labels: {},
    rev: 'applied',
    creatable: true,
    singular: 'GRPC tunnel server',
    nameLabel: 'Server',
  },
  {
    key: 'cp-trap',
    parent: 'system',
    label: 'Control-plane traps',
    icon: 'object',
    collection: '/system/control-plane/trap',
    item: '/system/control-plane/trap/{trap-id}',
    fields: ['state'],
    labels: {},
    rev: 'applied',
    singular: 'Control-plane trap',
    nameLabel: 'Trap',
  },
  {
    key: 'cp-policer',
    parent: 'system',
    label: 'Control-plane policers',
    icon: 'object',
    collection: '/system/control-plane/policer',
    item: '/system/control-plane/policer/{policer-id}',
    fields: ['state', 'rate', 'burst'],
    labels: {},
    rev: 'applied',
    singular: 'Control-plane policer',
    nameLabel: 'Policer',
  },
  {
    key: 'cp-acl',
    parent: 'system',
    label: 'Control-plane ACLs',
    icon: 'object',
    collection: '/system/control-plane/acl',
    item: '/system/control-plane/acl/{acl-id}',
    fields: [],
    labels: {},
    rev: 'applied',
    singular: 'Control-plane ACL',
    nameLabel: 'ACL',
  },
  {
    key: 'wjh-channel',
    parent: 'system',
    label: 'WJH channels',
    icon: 'object',
    collection: '/system/wjh/channel',
    item: '/system/wjh/channel/{channel-id}',
    fields: [],
    labels: {},
    rev: 'applied',
    singular: 'WJH channel',
    nameLabel: 'Channel',
  },
  {
    key: 'snmp',
    parent: 'system',
    label: 'SNMP',
    icon: 'object',
    collection: '/system/snmp-server',
    item: '/system/snmp-server',
    singleton: true,
    name: 'snmp-server',
    fields: ['auto-refresh-interval', 'trap-link-up/check-frequency', 'trap-link-down/check-frequency'],
    labels: {},
    rev: 'applied',
  },
  {
    key: 'ztp',
    parent: 'system',
    label: 'ZTP',
    icon: 'object',
    collection: '/system/ztp',
    item: '/system/ztp',
    singleton: true,
    name: 'ztp',
    fields: [],
    labels: {},
    editable: false,
    rev: 'applied',
  },
  {
    key: 'config-apply',
    parent: 'system',
    label: 'Config apply',
    icon: 'object',
    collection: '/system/config/apply',
    item: '/system/config/apply',
    singleton: true,
    name: 'apply',
    fields: ['overwrite'],
    labels: {},
    rev: 'applied',
  },
  {
    key: 'config-autosave',
    parent: 'system',
    label: 'Config autosave',
    icon: 'object',
    collection: '/system/config/auto-save',
    item: '/system/config/auto-save',
    singleton: true,
    name: 'auto-save',
    fields: [],
    labels: {},
    editable: false,
    rev: 'applied',
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
