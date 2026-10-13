/**
 * Journey catalog (journey-roadmap.md §3): guided operations as registry data.
 * Server-owned like the widget catalog — the UI renders whatever ships here
 * and can only start known keys. Every write rides the normal stage → dry-run
 * → apply path; every gate is a server-side read (engine.ts), never a click.
 *
 * Refs: `{{step.name}}` is a value an earlier step captured; `{{item}}` is the
 * current element of an `each` list. In paths a ref fills (encoded) one
 * segment; a whole-string ref in a body keeps its type (numbers stay numbers,
 * lists expand map keys) and an empty optional ref drops its key.
 */

export type JourneyArea = 'provision' | 'diagnose';

/** One operator input. Values are validated server-side before any step uses them. */
export interface InputField {
  name: string;
  label: string;
  hint?: string;
  /** `prefix` = IPv4 CIDR; `list` = comma/space separated items, each matching `pattern`. */
  kind: 'text' | 'number' | 'list' | 'prefix' | 'choice';
  pattern?: string;
  min?: number;
  max?: number;
  choices?: string[];
  optional?: boolean;
  default?: string;
  /** Required only when another field of the same step has this value. */
  requiredWhen?: { field: string; equals: string };
}

/** A templated NVUE write; `each` repeats it per item of a list value. */
export interface CallTemplate {
  method: 'PATCH' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  each?: string;
}

/**
 * One assertion over a read; `at` is a `/`-path inside the result (`*` = any
 * key, '' = the read itself). `except` ignores values equal to it (a route's
 * next hop naming its own VRF is not a leak).
 */
export type Expect =
  { at: string; op: 'exists' | 'absent'; except?: string } | { at: string; op: 'equals'; value: string };

/** A value to keep: the first found at `at`, skipping `except`. */
export type Capture = string | { at: string; except: string };

/** A gate: read `path` on every member (per item with `each`); all expectations must hold everywhere. */
export interface Verify {
  path: string;
  /** `applied` reads configuration; omitted reads operational state. */
  rev?: 'applied';
  each?: string;
  expect: Expect[];
  /** Values to keep for later steps: name → where to find it. */
  capture?: Record<string, Capture>;
}

/** Where a verify outcome leads instead of the default (pass → next, fail → blocked). */
export interface Outcome {
  goto: string;
  /** Shown on the run; `{{refs}}` resolve. `goto: 'end'` finishes the journey with it. */
  note?: string;
}

interface StepBase {
  id: string;
  title: string;
  help: string;
  /** Step applies only when the ref has a value (and equals `equals`, if given); otherwise skipped. */
  when?: { ref: string; equals?: string };
  skippable?: boolean;
}

export type JourneyStep =
  | (StepBase & {
      kind: 'input';
      fields: InputField[];
      /** Derived values: name → network address of a prefix field. */
      derive?: Record<string, { from: string; fn: 'network' }>;
    })
  | (StepBase & { kind: 'change'; calls: CallTemplate[]; verify: Verify })
  | (StepBase & { kind: 'verify'; verify: Verify; onPass?: Outcome; onFail?: Outcome });

export interface Journey {
  key: string;
  label: string;
  summary: string;
  area: JourneyArea;
  steps: JourneyStep[];
}

const NAME = '^[A-Za-z][A-Za-z0-9_.-]{0,14}$';
const BRIDGE = '^[A-Za-z][A-Za-z0-9_-]{0,15}$';

export const JOURNEYS: Journey[] = [
  {
    key: 'vrf-bringup',
    label: 'New VRF end-to-end',
    summary: 'VRF, SVI gateway, BGP and EVPN L3 VNI, then the gateway subnet in the VRF routing table.',
    area: 'provision',
    steps: [
      {
        id: 'vrf',
        kind: 'input',
        title: 'Describe the VRF',
        help: 'Every later step is pre-filled from these values.',
        fields: [
          {
            name: 'name',
            label: 'VRF name',
            kind: 'text',
            pattern: NAME,
            hint: 'a letter, then up to 14 of A–z 0–9 . _ -',
          },
          { name: 'vid', label: 'SVI VLAN', kind: 'number', min: 1, max: 4094 },
          { name: 'gateway', label: 'Gateway address', kind: 'prefix', hint: 'e.g. 10.1.10.1/24' },
          { name: 'bridge', label: 'Bridge domain', kind: 'text', pattern: BRIDGE, default: 'br_default' },
          { name: 'vni', label: 'L3 VNI', kind: 'number', min: 1, max: 16777214, optional: true },
        ],
        derive: { net: { from: 'gateway', fn: 'network' } },
      },
      {
        id: 'create',
        kind: 'change',
        title: 'Create the VRF',
        help: 'Adds the VRF with an automatically assigned routing table.',
        calls: [{ method: 'PATCH', path: '/vrf/{{vrf.name}}', body: { table: 'auto' } }],
        verify: { path: '/vrf/{{vrf.name}}', rev: 'applied', expect: [{ at: 'table', op: 'exists' }] },
      },
      {
        id: 'svi',
        kind: 'change',
        title: 'SVI and gateway',
        help: 'Adds the VLAN to the bridge and gives its SVI the gateway address inside the VRF.',
        calls: [
          { method: 'PATCH', path: '/bridge/domain/{{vrf.bridge}}/vlan/{{vrf.vid}}', body: {} },
          {
            method: 'PATCH',
            path: '/interface/vlan{{vrf.vid}}',
            body: {
              type: 'svi',
              vlan: '{{vrf.vid}}',
              'base-interface': '{{vrf.bridge}}',
              ip: { vrf: '{{vrf.name}}', address: { '{{vrf.gateway}}': {} } },
            },
          },
        ],
        verify: {
          path: '/interface/vlan{{vrf.vid}}',
          rev: 'applied',
          expect: [
            { at: 'ip/vrf', op: 'equals', value: '{{vrf.name}}' },
            { at: 'ip/address/{{vrf.gateway}}', op: 'exists' },
          ],
        },
      },
      {
        id: 'bgp',
        kind: 'change',
        title: 'BGP in the VRF',
        help: 'Enables BGP in the VRF and redistributes connected subnets. Needs the switch-wide BGP ASN (Router › BGP).',
        skippable: true,
        calls: [
          {
            method: 'PATCH',
            path: '/vrf/{{vrf.name}}/router/bgp',
            body: {
              enable: 'on',
              'address-family': {
                'ipv4-unicast': { enable: 'on', redistribute: { connected: { enable: 'on' } } },
              },
            },
          },
        ],
        verify: {
          path: '/vrf/{{vrf.name}}/router/bgp',
          rev: 'applied',
          expect: [{ at: 'enable', op: 'equals', value: 'on' }],
        },
      },
      {
        id: 'evpn',
        kind: 'change',
        title: 'EVPN L3 VNI',
        help: 'Maps the VRF to its L3 VNI and exports its routes to EVPN (type-5).',
        when: { ref: 'vrf.vni' },
        skippable: true,
        calls: [
          {
            method: 'PATCH',
            path: '/vrf/{{vrf.name}}/evpn',
            body: { enable: 'on', vni: { '{{vrf.vni}}': {} } },
          },
          {
            method: 'PATCH',
            path: '/vrf/{{vrf.name}}/router/bgp/address-family/ipv4-unicast/route-export/to-evpn',
            body: { enable: 'on' },
          },
        ],
        verify: {
          path: '/vrf/{{vrf.name}}/evpn',
          rev: 'applied',
          expect: [
            { at: 'enable', op: 'equals', value: 'on' },
            { at: 'vni/{{vrf.vni}}', op: 'exists' },
          ],
        },
      },
      {
        id: 'routes',
        kind: 'verify',
        title: 'Gateway subnet in the VRF',
        help: 'The connected subnet appears once a port in the VLAN is up; skip if none is cabled yet.',
        skippable: true,
        verify: {
          path: '/vrf/{{vrf.name}}/router/rib/ipv4/route/{{vrf.net}}',
          expect: [{ at: 'route-entry/*/protocol', op: 'equals', value: 'connected' }],
        },
      },
    ],
  },
  {
    key: 'server-attach',
    label: 'New server attach',
    summary: 'Bond with members, MTU, access VLAN and MLAG, admin up, then link and LLDP checks.',
    area: 'provision',
    steps: [
      {
        id: 'attach',
        kind: 'input',
        title: 'Describe the attachment',
        help: 'One bond toward the server; on an MLAG pair run this on the group so both peers match.',
        fields: [
          { name: 'bond', label: 'Bond name', kind: 'text', pattern: NAME, hint: 'e.g. bond1' },
          {
            name: 'members',
            label: 'Member ports',
            kind: 'list',
            pattern: '^swp[0-9]+(s[0-9]+)?$',
            hint: 'e.g. swp1, swp2',
          },
          { name: 'vlan', label: 'Access VLAN', kind: 'number', min: 1, max: 4094 },
          { name: 'bridge', label: 'Bridge domain', kind: 'text', pattern: BRIDGE, default: 'br_default' },
          { name: 'mtu', label: 'MTU', kind: 'number', min: 552, max: 9216, default: '9216' },
          { name: 'mlag', label: 'MLAG ID', kind: 'number', min: 1, max: 65535, optional: true },
          { name: 'description', label: 'Description', kind: 'text', pattern: '^.{0,64}$', optional: true },
        ],
      },
      {
        id: 'bond',
        kind: 'change',
        title: 'Bond and members',
        help: 'Creates the bond with its member ports and MTU.',
        calls: [
          {
            method: 'PATCH',
            path: '/interface/{{attach.bond}}',
            body: {
              type: 'bond',
              description: '{{attach.description}}',
              bond: { member: { '{{attach.members}}': {} } },
              link: { mtu: '{{attach.mtu}}' },
            },
          },
        ],
        verify: {
          path: '/interface/{{attach.bond}}/bond/member/{{item}}',
          each: 'attach.members',
          rev: 'applied',
          expect: [{ at: '', op: 'exists' }],
        },
      },
      {
        id: 'access',
        kind: 'change',
        title: 'Access VLAN',
        help: 'Puts the bond in the bridge as an access port on the VLAN.',
        calls: [
          {
            method: 'PATCH',
            path: '/interface/{{attach.bond}}/bridge/domain/{{attach.bridge}}',
            body: { access: '{{attach.vlan}}' },
          },
        ],
        verify: {
          path: '/interface/{{attach.bond}}',
          rev: 'applied',
          expect: [{ at: 'bridge/domain/{{attach.bridge}}/access', op: 'equals', value: '{{attach.vlan}}' }],
        },
      },
      {
        id: 'mlag',
        kind: 'change',
        title: 'MLAG',
        help: 'Makes the bond dual-homed; use the same ID on both peers.',
        when: { ref: 'attach.mlag' },
        calls: [
          {
            method: 'PATCH',
            path: '/interface/{{attach.bond}}/bond/mlag',
            body: { enable: 'on', id: '{{attach.mlag}}' },
          },
        ],
        verify: {
          path: '/interface/{{attach.bond}}/bond/mlag',
          rev: 'applied',
          expect: [{ at: 'id', op: 'equals', value: '{{attach.mlag}}' }],
        },
      },
      {
        id: 'up',
        kind: 'change',
        title: 'Admin up',
        help: 'Brings members and bond up, then waits for the bond to come up. Skip if the server is not cabled yet.',
        skippable: true,
        calls: [
          {
            method: 'PATCH',
            path: '/interface/{{item}}/link',
            body: { state: { up: {} } },
            each: 'attach.members',
          },
          { method: 'PATCH', path: '/interface/{{attach.bond}}/link', body: { state: { up: {} } } },
        ],
        verify: {
          path: '/interface/{{attach.bond}}/link',
          expect: [{ at: 'oper-status', op: 'equals', value: 'up' }],
        },
      },
      {
        id: 'lldp',
        kind: 'verify',
        title: 'Server seen on every member',
        help: 'LLDP neighbors on each member port. Skip for servers without an LLDP agent.',
        skippable: true,
        verify: {
          path: '/interface/{{item}}/lldp/neighbor',
          each: 'attach.members',
          expect: [{ at: '*', op: 'exists' }],
        },
      },
    ],
  },
  {
    key: 'route-leak',
    label: 'Route leak',
    summary:
      'Confirm a prefix in the wrong VRF, trace the exporting VRF, check the import policy, tighten it, verify.',
    area: 'diagnose',
    steps: [
      {
        id: 'leak',
        kind: 'input',
        title: 'What leaked where',
        help: 'The VRF that should not have the route, and the prefix it shows.',
        fields: [
          { name: 'vrf', label: 'VRF with the route', kind: 'text', pattern: NAME },
          { name: 'prefix', label: 'Leaked prefix', kind: 'prefix', hint: 'e.g. 10.20.0.0/16' },
        ],
        derive: { net: { from: 'prefix', fn: 'network' } },
      },
      {
        id: 'present',
        kind: 'verify',
        title: 'Prefix in the VRF',
        help: 'Looks the prefix up in the VRF routing table.',
        verify: {
          path: '/vrf/{{leak.vrf}}/router/rib/ipv4/route/{{leak.net}}',
          expect: [{ at: 'route-entry/*', op: 'exists' }],
          capture: { protocol: 'route-entry/*/protocol' },
        },
        onFail: { goto: 'end', note: '{{leak.net}} is not in {{leak.vrf}} — nothing is leaking here.' },
      },
      {
        id: 'exporter',
        kind: 'verify',
        title: 'Which VRF exports it',
        help: 'A leaked route resolves through another VRF; its next hop names that VRF.',
        verify: {
          path: '/vrf/{{leak.vrf}}/router/rib/ipv4/route/{{leak.net}}',
          expect: [{ at: 'route-entry/*/via-entry/*/vrf', op: 'exists', except: '{{leak.vrf}}' }],
          capture: { source: { at: 'route-entry/*/via-entry/*/vrf', except: '{{leak.vrf}}' } },
        },
        onFail: {
          goto: 'end',
          note: '{{leak.net}} resolves inside {{leak.vrf}} itself ({{present.protocol}}) — it is native, not leaked. Trace its origin instead.',
        },
      },
      {
        id: 'import',
        kind: 'verify',
        title: 'Import policy',
        help: 'Checks whether this VRF imports routes from the exporting VRF, and through which route-map.',
        verify: {
          path: '/vrf/{{leak.vrf}}/router/bgp/address-family/ipv4-unicast/route-import/from-vrf',
          rev: 'applied',
          expect: [{ at: 'list/{{exporter.source}}', op: 'exists' }],
          capture: { routemap: 'route-map' },
        },
        onFail: {
          goto: 'end',
          note: '{{leak.vrf}} does not import from {{exporter.source}} — the route arrives another way (static next-hop VRF or EVPN route targets).',
        },
      },
      {
        id: 'fix',
        kind: 'input',
        title: 'Choose the fix',
        help: 'Stop the import entirely, or filter it through a route-map that already exists under Router › Policy.',
        fields: [
          { name: 'remedy', label: 'Fix', kind: 'choice', choices: ['remove-import', 'route-map'] },
          {
            name: 'routemap',
            label: 'Route-map',
            kind: 'text',
            pattern: '^[A-Za-z0-9_.:-]{1,63}$',
            optional: true,
            requiredWhen: { field: 'remedy', equals: 'route-map' },
          },
        ],
      },
      {
        id: 'unimport',
        kind: 'change',
        title: 'Stop the import',
        help: 'Removes the exporting VRF from this VRF’s import list.',
        when: { ref: 'fix.remedy', equals: 'remove-import' },
        calls: [
          {
            method: 'DELETE',
            path: '/vrf/{{leak.vrf}}/router/bgp/address-family/ipv4-unicast/route-import/from-vrf/list/{{exporter.source}}',
          },
        ],
        verify: {
          path: '/vrf/{{leak.vrf}}/router/bgp/address-family/ipv4-unicast/route-import/from-vrf',
          rev: 'applied',
          expect: [{ at: 'list/{{exporter.source}}', op: 'absent' }],
        },
      },
      {
        id: 'routemap',
        kind: 'verify',
        title: 'Route-map exists',
        help: 'The filter must exist before the import can use it.',
        when: { ref: 'fix.remedy', equals: 'route-map' },
        verify: {
          path: '/router/policy/route-map/{{fix.routemap}}',
          rev: 'applied',
          expect: [{ at: '', op: 'exists' }],
        },
      },
      {
        id: 'filter',
        kind: 'change',
        title: 'Filter the import',
        help: 'Attaches the route-map to the VRF import.',
        when: { ref: 'fix.remedy', equals: 'route-map' },
        calls: [
          {
            method: 'PATCH',
            path: '/vrf/{{leak.vrf}}/router/bgp/address-family/ipv4-unicast/route-import/from-vrf',
            body: { 'route-map': '{{fix.routemap}}' },
          },
        ],
        verify: {
          path: '/vrf/{{leak.vrf}}/router/bgp/address-family/ipv4-unicast/route-import/from-vrf',
          rev: 'applied',
          expect: [{ at: 'route-map', op: 'equals', value: '{{fix.routemap}}' }],
        },
      },
      {
        id: 'gone',
        kind: 'verify',
        title: 'Leak gone',
        help: 'No route entry for the prefix resolves through another VRF any more.',
        verify: {
          path: '/vrf/{{leak.vrf}}/router/rib/ipv4/route/{{leak.net}}',
          expect: [{ at: 'route-entry/*/via-entry/*/vrf', op: 'absent', except: '{{leak.vrf}}' }],
        },
      },
    ],
  },
];

/** Catalog lookup by key. */
export function journeyOf(key: string): Journey | undefined {
  return JOURNEYS.find((j) => j.key === key);
}
