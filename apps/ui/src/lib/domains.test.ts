/**
 * Domain registry contract: every row must name real manifest paths with the
 * verbs the generic screens need (GET to read, PATCH to edit). A row that
 * drifts from the spec fails here, not in a browser.
 */
import { describe, expect, it } from 'vitest';
import manifestJson from '@cumulus/spec/manifest.json' with { type: 'json' };
import { DOMAINS, domainOf, sectionDomains } from './domains.js';

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

  it('singletons are detail objects, collections are tables', () => {
    // NVUE singletons (`/evpn`, `/mlag`, …) are one object per switch:
    // collection === item, never created per-row, so screens render detail
    // tabs — never a one-row table.
    for (const d of DOMAINS.filter((x) => x.singleton)) {
      expect(d.collection, d.key).toBe(d.item);
      expect(d.creatable ?? false, d.key).toBe(false);
    }
    for (const d of DOMAINS.filter((x) => !x.singleton && !x.sections)) {
      expect(d.item, d.key).toContain('{');
    }
  });

  it('containers are one object with sections; every child domain is linked from its section', () => {
    for (const d of DOMAINS.filter((x) => x.sections)) {
      expect(d.collection, d.key).toBe(d.item);
      expect(d.creatable ?? false, d.key).toBe(false);
    }
    for (const d of DOMAINS.filter((x) => x.parent)) {
      const parent = domainOf(d.parent ?? '');
      expect(parent?.sections, d.key).toBe(true);
      expect(d.collection.startsWith(`${parent?.collection ?? '?'}/`), d.key).toBe(true);
      const section = d.collection.slice((parent?.collection.length ?? 0) + 1).split('/')[0] ?? '';
      // The section is a real object (it gets an index entry), and its card links here.
      expect(manifest.routes[`${parent?.collection ?? ''}/${section}`], d.key).toContain('get');
      expect(parent && sectionDomains(parent, section).map((x) => x.key), d.key).toContain(d.key);
    }
  });

  it('resolves by key', () => {
    expect(domainOf('vrf')?.collection).toBe('/vrf');
    expect(domainOf('nope')).toBeUndefined();
  });
});
