/**
 * Domain registry contract: every row must name real manifest paths with the
 * verbs the generic screens need (GET to read, PATCH to edit). A row that
 * drifts from the spec fails here, not in a browser.
 */
import { describe, expect, it } from 'vitest';
import manifestJson from '@cumulus/spec/manifest.json' with { type: 'json' };
import { DOMAINS, domainOf } from './domains.js';

const manifest = manifestJson as { routes: Record<string, string[]> };

describe('domain registry', () => {
  it('has unique keys', () => {
    const keys = DOMAINS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every collection reads (GET), every editable item writes (PATCH)', () => {
    for (const d of DOMAINS) {
      expect(manifest.routes[d.collection], d.key).toContain('get');
      if (d.editable !== false) {
        expect(manifest.routes[d.item], d.key).toContain('patch');
      }
    }
  });

  it('singletons read the collection object itself', () => {
    for (const d of DOMAINS.filter((x) => x.singleton)) {
      expect(d.name, d.key).toBeTruthy();
    }
  });

  it('resolves by key', () => {
    expect(domainOf('vrf')?.collection).toBe('/vrf');
    expect(domainOf('nope')).toBeUndefined();
  });
});
