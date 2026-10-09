import { describe, expect, it } from 'vitest';
import { clearAllBody, clearOneBody, macEntries, macRows } from './mac.js';

// `GET /bridge/domain/br_default/mac-table` as NVUE 5.14 returns it: entries
// keyed by MAC plus the `dynamic` action child (no entries under it here).
const TABLE = {
  dynamic: { '@clear': { state: 'inactive' } },
  '00:11:22:33:44:55': {
    mac: '00:11:22:33:44:55',
    vlan: 10,
    interface: 'swp1',
    'entry-type': 'dynamic',
    age: 42,
  },
  '00:11:22:33:44:66': { vlan: 20, interface: 'swp2', 'entry-type': 'static' },
};

describe('macEntries', () => {
  it('keeps entries, drops the dynamic action child; the key fills a missing mac leaf', () => {
    const entries = macEntries(TABLE);
    expect(Object.keys(entries ?? {}).sort()).toEqual(['00:11:22:33:44:55', '00:11:22:33:44:66']);
    expect(entries?.['00:11:22:33:44:55']).toMatchObject({
      mac: '00:11:22:33:44:55',
      vlan: '10',
      iface: 'swp1',
      type: 'dynamic',
      age: '42',
    });
    expect(entries?.['00:11:22:33:44:66']).toMatchObject({
      mac: '00:11:22:33:44:66',
      vlan: '20',
      age: '',
    });
  });
  it('is undefined when the read is missing, empty when nothing learned', () => {
    expect(macEntries(undefined)).toBeUndefined();
    expect(macEntries({ dynamic: {} })).toEqual({});
  });
});

describe('macRows', () => {
  it('flattens one row per MAC per present switch', () => {
    expect(macRows(['leaf01', 'sw2'], { leaf01: macEntries(TABLE), sw2: undefined })).toHaveLength(2);
    expect(macRows(['leaf01'], { leaf01: macEntries(TABLE) })[0]).toMatchObject({ sw: 'leaf01' });
  });
});

describe('clear bodies', () => {
  it('matches NVUE simple-action shape; the single clear names its MAC', () => {
    expect(clearAllBody()).toEqual({ '@clear': { state: 'start' } });
    expect(clearOneBody('00:11:22:33:44:55')).toEqual({
      '@clear': { state: 'start', parameters: { 'mac-address-id': '00:11:22:33:44:55' } },
    });
  });
});
