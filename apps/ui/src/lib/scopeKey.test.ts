import { describe, expect, it } from 'vitest';
import { nvueKey } from './scopeKey';

describe('nvueKey', () => {
  it('defaults to operational rev with null view', () => {
    expect(nvueKey({ switchId: 'leaf01' }, '/interface')).toEqual([
      'nvue',
      'leaf01',
      '/interface',
      'operational',
      null,
    ]);
  });

  it('encodes rev + view', () => {
    expect(nvueKey({ switchId: 'leaf01' }, '/interface/swp1', 'applied', 'counters')).toEqual([
      'nvue',
      'leaf01',
      '/interface/swp1',
      'applied',
      'counters',
    ]);
  });

  it('differs per switch', () => {
    expect(nvueKey({ switchId: 'a' }, '/interface')).not.toEqual(nvueKey({ switchId: 'b' }, '/interface'));
  });
});
