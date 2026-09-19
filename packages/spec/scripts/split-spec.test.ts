import { describe, expect, it } from 'vitest';
import { groupPaths, topSegment } from './split-spec.js';

describe('split-spec', () => {
  it('topSegment keys paths by first segment', () => {
    expect(topSegment('/')).toBe('root');
    expect(topSegment('/vrf/{id}/router/bgp')).toBe('vrf');
    expect(topSegment('/interface')).toBe('interface');
  });

  it('groupPaths buckets every path exactly once', () => {
    const groups = groupPaths({ '/': {}, '/vrf': {}, '/vrf/{id}': {}, '/router/bgp': {} });
    expect(Object.keys(groups).sort()).toEqual(['root', 'router', 'vrf']);
    expect(Object.keys(groups['vrf'] ?? {}).sort()).toEqual(['/vrf', '/vrf/{id}']);
  });
});
