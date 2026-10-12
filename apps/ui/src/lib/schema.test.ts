import { describe, expect, it } from 'vitest';
import { itemSchema, leafLabel, planFieldsFromSchema, scalarLeaves, toIncludePatterns } from './schema.js';

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
    expect(
      itemSchema({ anyOf: [{ properties: { '@clear': {} } }, { additionalProperties: ifaceItem }] }),
    ).toBe(ifaceItem);
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

const patchBody = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    type: { type: 'string', enum: ['swp', 'bond'] },
    link: {
      type: 'object',
      properties: { mtu: { type: 'integer', minimum: 576, maximum: 9216 } },
    },
  },
};

describe('planFieldsFromSchema', () => {
  it('resolves kinds, choices and validation from the schema', () => {
    const fields = planFieldsFromSchema(patchBody, { only: ['description', 'type', 'link/mtu'] });
    expect(fields.map((f) => [f.path, f.kind, f.label])).toEqual([
      ['description', 'text', 'Description'],
      ['type', 'choice', 'Type'],
      ['link/mtu', 'number', 'Mtu'],
    ]);
    expect(fields[1]?.choices).toEqual(['swp', 'bond']);
    expect(fields[2]?.invalid('100000')).toMatch(/at most 9216/);
    expect(fields[2]?.invalid('9000')).toBeNull();
  });

  it('honors label overrides and enumerates leaves without `only`', () => {
    const fields = planFieldsFromSchema(patchBody, { labels: { 'link/mtu': 'MTU' } });
    expect(fields.map((f) => f.path).sort()).toEqual(['description', 'link/mtu', 'type']);
    expect(fields.find((f) => f.path === 'link/mtu')?.label).toBe('MTU');
  });
});
