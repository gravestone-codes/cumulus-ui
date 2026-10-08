import { describe, expect, it } from 'vitest';
import { domainPorts, domainVlans } from './members.js';

// Applied shapes as leaf01 returns them (NVUE 5.14).
const APPLIED = {
  swp1: { type: 'swp', bridge: { domain: { br_default: { vlan: { '20': {}, '10': {} }, untagged: 10 } } } },
  swp2: { type: 'swp', bridge: { domain: { br_default: { access: 30 } } } },
  swp3: { type: 'swp', bridge: { domain: { br_other: {} } } },
  swp4: { type: 'swp', link: { mtu: 9216 } },
};

describe('domainPorts', () => {
  it('keeps only this domain’s members, with state from operational reads', () => {
    const ports = domainPorts(APPLIED, { swp1: { link: { 'oper-status': 'up' } } }, 'br_default');
    expect(Object.keys(ports ?? {})).toEqual(['swp1', 'swp2']);
    expect(ports?.['swp1']).toMatchObject({ state: 'up', vlans: '10, 20', untagged: '10', access: '' });
    expect(ports?.['swp2']).toMatchObject({ access: '30', vlans: '', state: '' });
  });
  it('is undefined when the interface read is missing, empty when nothing is a member', () => {
    expect(domainPorts(undefined, undefined, 'br_default')).toBeUndefined();
    expect(domainPorts({ swp4: APPLIED.swp4 }, undefined, 'br_default')).toEqual({});
  });
});

describe('domainVlans', () => {
  it('maps VLAN ids to their objects; absent domain stays undefined', () => {
    const br = { vlan: { '1': { vni: {} }, '10': { vni: { '10010': {} } } } };
    expect(domainVlans(br)).toEqual(br.vlan);
    expect(domainVlans({ type: 'vlan-aware' })).toEqual({});
    expect(domainVlans(undefined)).toBeUndefined();
  });
});
