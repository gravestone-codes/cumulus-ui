/**
 * Bridge domain config sections (roadmap 3B.1). Same SectionDef shape and
 * edit flow as interfaces; which subtrees appear and their labels is
 * presentation, every option and bound still comes from the spec. STP joins
 * with 3B.4, the VLAN↔VNI map is read-only until 3D wires VNIs.
 */
import type { SectionDef } from '../iface/sections.js';

export const DOMAIN_SECTIONS: SectionDef[] = [
  {
    id: 'general',
    title: 'General',
    base: '',
    pinned: true,
    fields: [
      { leaf: 'type', label: 'Type' },
      { leaf: 'encap', label: 'Encapsulation' },
      { leaf: 'ageing', label: 'MAC ageing (s)' },
      { leaf: 'mac-address', label: 'MAC address', perSwitch: true },
    ],
  },
  {
    id: 'vlans',
    title: 'VLANs',
    base: '',
    pinned: true,
    fields: [
      { leaf: 'vlan', label: 'VLANs' },
      { leaf: 'untagged', label: 'Untagged (PVID)' },
      { leaf: 'vlan-vni-offset', label: 'VNI offset' },
    ],
  },
  {
    id: 'multicast',
    title: 'Multicast',
    base: 'multicast/snooping',
    fields: [{ leaf: 'enable', label: 'IGMP/MLD snooping' }],
  },
  {
    id: 'svi',
    title: 'SVI force-up',
    base: 'svi-force-up',
    fields: [{ leaf: 'enable', label: 'Keep SVIs up' }],
  },
];
