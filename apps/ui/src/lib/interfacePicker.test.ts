import { describe, expect, it } from 'vitest';
import { bondedPorts, filterOptions, missingOn, optionTypes, pickerOptions } from './interfacePicker.js';

const lists = {
  leaf01: {
    swp1: { type: 'swp' },
    swp2: { type: 'swp' },
    swp10: { type: 'swp' },
    eth0: { type: 'eth' },
    bond1: { type: 'bond', bond: { member: { swp1: {} } } },
  },
  SW2: {
    swp2: { type: 'swp' },
    swp10: { type: 'swp' },
    bond2: { type: 'bond', bond: { member: { swp2: {} } } },
  },
};
const members = ['leaf01', 'SW2'];

describe('pickerOptions', () => {
  it('unions members, records who has each, sorts naturally', () => {
    const opts = pickerOptions(members, lists, { types: ['swp'] });
    expect(opts.map((o) => o.name)).toEqual(['swp1', 'swp2', 'swp10']);
    expect(opts.find((o) => o.name === 'swp1')?.have).toEqual(['leaf01']);
    expect(opts.find((o) => o.name === 'swp2')?.have).toEqual(['leaf01', 'SW2']);
  });

  it('drops excluded names and members that failed to read', () => {
    const opts = pickerOptions(
      members,
      { leaf01: lists.leaf01, SW2: undefined },
      { exclude: ['swp1', 'bond1'] },
    );
    expect(opts.map((o) => o.name)).toEqual(['eth0', 'swp2', 'swp10']);
    expect(opts.every((o) => o.have.length === 1)).toBe(true);
  });
});

describe('bondedPorts', () => {
  it('collects bond members from every switch', () => {
    expect([...bondedPorts(lists)].sort()).toEqual(['swp1', 'swp2']);
  });
});

describe('filterOptions', () => {
  const opts = pickerOptions(members, lists);
  it('searches by name and filters by type', () => {
    expect(filterOptions(opts, 'SWP1').map((o) => o.name)).toEqual(['swp1', 'swp10']);
    expect(filterOptions(opts, '', 'bond').map((o) => o.name)).toEqual(['bond1', 'bond2']);
    expect(filterOptions(opts, '2', 'bond').map((o) => o.name)).toEqual(['bond2']);
  });
  it('lists the types present', () => {
    expect(optionTypes(opts)).toEqual(['bond', 'eth', 'swp']);
  });
});

describe('missingOn', () => {
  it('reports picks absent on some members', () => {
    const opts = pickerOptions(members, lists);
    expect(missingOn(opts, ['swp1', 'swp2'], members)).toEqual([{ name: 'swp1', lacking: ['SW2'] }]);
    expect(missingOn(opts, ['swp10'], members)).toEqual([]);
  });
});
