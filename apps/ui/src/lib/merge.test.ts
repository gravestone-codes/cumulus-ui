import { describe, expect, it } from 'vitest';
import { fillPattern, majority, mergeValues, presence } from './merge.js';

describe('mergeValues', () => {
  it('agrees, disagrees (largest group first), or has nothing', () => {
    expect(mergeValues({ a: '9216', b: '9216' })).toEqual({ kind: 'same', value: '9216' });
    const mixed = mergeValues({ a: '9216', b: '1500', c: '9216' });
    expect(mixed).toEqual({
      kind: 'mixed',
      groups: [
        { value: '9216', switches: ['a', 'c'] },
        { value: '1500', switches: ['b'] },
      ],
    });
    expect(majority(mixed)).toBe('9216');
    expect(mergeValues({})).toEqual({ kind: 'none' });
  });
});

describe('presence', () => {
  it('splits members holding the object from those lacking it', () => {
    expect(presence(['a', 'b', 'c'], { a: {}, c: {} })).toEqual({ present: ['a', 'c'], absent: ['b'] });
  });
});

describe('fillPattern', () => {
  it('fills index terms and switch ids per member', () => {
    expect(fillPattern('10.0.0.{2n-1}/31', ['l1', 'l2', 'l3'])).toEqual({
      l1: '10.0.0.1/31',
      l2: '10.0.0.3/31',
      l3: '10.0.0.5/31',
    });
    expect(fillPattern('to {sw} #{n}', ['x'])).toEqual({ x: 'to x #1' });
  });
});
