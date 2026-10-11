import { describe, expect, it } from 'vitest';
import { dangerOfDelete } from './danger.js';

describe('dangerOfDelete', () => {
  it('calls bond and domain deletes service-affecting', () => {
    expect(dangerOfDelete('/interface/bond0')).toBe('service');
    expect(dangerOfDelete('/bridge/domain/br_default')).toBe('service');
    expect(dangerOfDelete('/vrf/blue')).toBe('service');
    expect(dangerOfDelete('/router/bgp')).toBe('service');
  });

  it('calls AAA and image deletes dangerous', () => {
    expect(dangerOfDelete('/system/aaa/user/x')).toBe('dangerous');
    expect(dangerOfDelete('/system/packages')).toBe('dangerous');
  });

  it('leaves anything else routine', () => {
    expect(dangerOfDelete('/system/syslog/server/s1')).toBe('routine');
    expect(dangerOfDelete('/platform')).toBe('routine');
  });
});
