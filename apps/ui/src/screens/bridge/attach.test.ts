import { describe, expect, it } from 'vitest';
import {
  attachBody,
  invalidAttach,
  planAttachCalls,
  planDetachCalls,
  portAttachment,
  type AttachInput,
  type PortAttachment,
} from './attach.js';

const ACCESS: AttachInput = { mode: 'access', access: '30', vlans: '', untagged: '' };
const TRUNK: AttachInput = { mode: 'trunk', access: '', vlans: '10, 20', untagged: '10' };
const OFF: PortAttachment = { access: '', vlans: '', untagged: '' };

describe('invalidAttach', () => {
  it('requires an in-range access VID', () => {
    expect(invalidAttach(ACCESS)).toBeNull();
    expect(invalidAttach({ ...ACCESS, access: '' })).toBe('Access VLAN is required.');
    expect(invalidAttach({ ...ACCESS, access: '5000' })).toBe('Access VLAN: Must be at most 4094.');
    expect(invalidAttach({ ...ACCESS, access: '1.5' })).toBe('Access VLAN: Must be a whole number.');
  });
  it('requires a trunk list, with untagged inside it', () => {
    expect(invalidAttach(TRUNK)).toBeNull();
    expect(invalidAttach({ ...TRUNK, vlans: '' })).toBe('VLANs are required (comma-separated).');
    expect(invalidAttach({ ...TRUNK, vlans: '10, 5000' })).toBe('VLAN 5000: Must be at most 4094.');
    expect(invalidAttach({ ...TRUNK, untagged: '30' })).toBe('Untagged must be one of the VLANs.');
    expect(invalidAttach({ ...TRUNK, untagged: '' })).toBeNull();
  });
});

describe('portAttachment', () => {
  it('reads access/vlan/untagged; detached stays undefined', () => {
    const iface = { bridge: { domain: { br_default: { access: 30 } } } };
    expect(portAttachment(iface, 'br_default')).toEqual({ access: '30', vlans: '', untagged: '' });
    expect(portAttachment(iface, 'br_other')).toBeUndefined();
    expect(portAttachment(undefined, 'br_default')).toBeUndefined();
  });
});

describe('attachBody', () => {
  it('attaches access with one leaf', () => {
    expect(attachBody(OFF, ACCESS)).toEqual({ access: 30 });
  });
  it('switching trunk to access clears the trunk leaves', () => {
    expect(attachBody({ access: '', vlans: '10, 20', untagged: '10' }, ACCESS)).toEqual({
      access: 30,
      vlan: null,
      untagged: null,
    });
  });
  it('attaches a trunk whole, pinning kept VLANs and clearing access', () => {
    expect(attachBody({ access: '30', vlans: '', untagged: '' }, TRUNK)).toEqual({
      access: null,
      vlan: { '10': {}, '20': {} },
      untagged: 10,
    });
  });
  it('a changed trunk set keeps members and nulls removals', () => {
    expect(attachBody({ access: '', vlans: '10, 20', untagged: '10' }, TRUNK)).toEqual({});
    expect(
      attachBody({ access: '', vlans: '10, 20', untagged: '' }, { ...TRUNK, vlans: '20, 30', untagged: '' }),
    ).toEqual({ vlan: { '20': {}, '30': {}, '10': null } });
  });
});

describe('planAttachCalls', () => {
  const current = {
    a: { swp32: OFF },
    b: { swp32: { access: '30', vlans: '', untagged: '' } },
  };
  it('only touches switches that differ', () => {
    const plan = planAttachCalls('br_default', ['a', 'b'], ['swp32'], ACCESS, current);
    expect(plan).toEqual({
      ok: true,
      calls: {
        a: [{ path: '/interface/swp32/bridge/domain/br_default', method: 'PATCH', body: { access: 30 } }],
      },
      unchanged: ['b'],
    });
  });
  it('fans one trunk config out over several ports', () => {
    const plan = planAttachCalls('br_default', ['a'], ['swp1', 'swp2'], TRUNK, { a: {} });
    expect(plan.ok && plan.calls['a']?.length).toBe(2);
    expect(plan.ok && plan.calls['a']?.[0]).toEqual({
      path: '/interface/swp1/bridge/domain/br_default',
      method: 'PATCH',
      body: { vlan: { '10': {}, '20': {} }, untagged: 10 },
    });
  });
  it('skips switches missing the port itself', () => {
    const plan = planAttachCalls('br_default', ['a', 'b'], ['swp32'], ACCESS, current, undefined, {
      a: { swp32: true },
      b: {},
    });
    expect(plan.ok && Object.keys(plan.calls)).toEqual(['a']);
  });
  it('refuses empty picks, invalid forms and no-ops', () => {
    expect(planAttachCalls('br_default', ['a'], [], ACCESS, current)).toEqual({
      ok: false,
      error: 'Pick at least one port.',
    });
    expect(planAttachCalls('br_default', ['a'], ['swp32'], { ...ACCESS, access: '' }, current)).toEqual({
      ok: false,
      error: 'Access VLAN is required.',
    });
    expect(planAttachCalls('br_default', ['b'], ['swp32'], ACCESS, current)).toEqual({
      ok: false,
      error: 'No changes to stage.',
    });
  });
});

describe('planDetachCalls', () => {
  it('deletes only where attached, per port', () => {
    const plan = planDetachCalls('br_default', ['a', 'b'], ['swp32'], { a: { swp32: true }, b: {} });
    expect(plan).toEqual({
      ok: true,
      calls: { a: [{ path: '/interface/swp32/bridge/domain/br_default', method: 'DELETE' }] },
      unchanged: ['b'],
    });
    expect(planDetachCalls('br_default', ['a'], ['swp32'], { a: {} })).toEqual({
      ok: false,
      error: 'Nothing attached to detach.',
    });
  });
});
