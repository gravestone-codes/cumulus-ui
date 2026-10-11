import { describe, expect, it } from 'vitest';
import { itemSchema, leafLabel, scalarLeaves, toIncludePatterns } from './schema.js';

const ifaceItem = {
  type: 'object',
  properties: {
    type: { type: 'string', description: 'Interface type' },
    description: { type: 'string' },
    state: { type: 'string', enum: ['up', 'down'] },
    'mac-address': { type: 'string' },
    link: {
      type: 'object',
      properties: {
        speed: { type: 'string' },
        mtu: { type: 'integer' },
        'auto-negotiate': { type: 'string', enum: ['on', 'off'] },
      },
    },
    counters: { type: 'object' },
    member: { type: 'array', items: { type: 'string' } },
  },
};

describe('itemSchema', () => {
  it('unwraps map collections, arrays, plain objects, and anyOf mappings', () => {
    expect(itemSchema({ additionalProperties: ifaceItem })).toBe(ifaceItem);
    expect(itemSchema({ items: ifaceItem })).toBe(ifaceItem);
    expect(itemSchema(ifaceItem)?.['type']).toBe('object');
    expect(itemSchema({ anyOf: [{ properties: { '@clear': {} } }, { additionalProperties: ifaceItem }] })).toBe(
      ifaceItem,
    );
    expect(itemSchema(null)).toBeNull();
    expect(itemSchema({ type: 'string' })).toBeNull();
  });
});

describe('scalarLeaves', () => {
  it('flattens nested objects to slash paths, skipping arrays and bare objects', () => {
    const paths = scalarLeaves(ifaceItem).map((l) => l.path);
    expect(paths).toEqual([
      'type',
      'description',
      'state',
      'mac-address',
      'link/speed',
      'link/mtu',
      'link/auto-negotiate',
    ]);
  });

  it('marks enums and caps depth', () => {
    const byPath = Object.fromEntries(scalarLeaves(ifaceItem).map((l) => [l.path, l]));
    expect(byPath['state']?.kind).toBe('enum');
    expect(byPath['link/mtu']?.kind).toBe('integer');
    const deep = {
      properties: {
        a: {
          type: 'object',
          properties: {
            b: { type: 'string' },
            c: { type: 'object', properties: { d: { type: 'string' } } },
          },
        },
      },
    };
    expect(scalarLeaves(deep, '', 0, 2).map((l) => l.path)).toEqual(['a/b']);
    expect(scalarLeaves(deep).map((l) => l.path)).toEqual(['a/b', 'a/c/d']);
  });
});

describe('leafLabel', () => {
  it('prefers titles, prettifies keys', () => {
    expect(leafLabel('type', { title: 'Kind' })).toBe('Kind');
    expect(leafLabel('link/auto-negotiate')).toBe('Auto negotiate');
    expect(leafLabel('mac-address')).toBe('Mac address');
  });
});

describe('toIncludePatterns', () => {
  it('prefixes collection members, keeps item pointers root-relative', () => {
    expect(toIncludePatterns('/interface', ['type', 'link/speed'])).toEqual(['/*/type', '/*/link/speed']);
    expect(toIncludePatterns('/interface/{interface-id}', ['type'])).toEqual(['/type']);
  });
});
