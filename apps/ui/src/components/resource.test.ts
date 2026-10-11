import { describe, expect, it } from 'vitest';
import { detailPath } from './resource.js';

describe('detailPath', () => {
  it('resolves store identities to object paths', () => {
    expect(detailPath('interface', 'swp1')).toBe('/interface/swp1');
    expect(detailPath('bridge', 'br_default')).toBe('/bridge/domain/br_default');
    expect(detailPath('vrf', 'blue')).toBe('/vrf/blue');
    expect(detailPath('generic', '/system/syslog')).toBe('/system/syslog');
  });

  it('lets an explicit path override the derivation', () => {
    expect(detailPath('interface', 'swp1', '/custom')).toBe('/custom');
  });
});
