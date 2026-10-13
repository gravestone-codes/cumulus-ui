import { describe, expect, it } from 'vitest';
import {
  enableGates,
  itemSchema,
  leafLabel,
  planFieldsFromSchema,
  scalarLeaves,
  toIncludePatterns,
  sectionsOf,
} from './schema.js';

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

  it('keeps nullable on/off leaves typed as objects (NVUE `enable`)', () => {
    const nve = {
      properties: {
        vxlan: {
          type: 'object',
          properties: {
            enable: { type: 'object', nullable: true, enum: ['on', 'off', null], properties: {} },
            port: { type: 'integer' },
          },
        },
      },
    };
    expect(scalarLeaves(nve)).toEqual([
      expect.objectContaining({ path: 'vxlan/enable', kind: 'enum' }),
      expect.objectContaining({ path: 'vxlan/port', kind: 'integer' }),
    ]);
  });

  it('keeps value-or-keyword unions, skips unions with object branches', () => {
    const vrf = {
      properties: {
        table: {
          anyOf: [
            { type: 'integer', nullable: true },
            { type: 'string', nullable: true, enum: ['auto', null] },
          ],
        },
        mode: { anyOf: [{ enum: ['a'] }, { enum: ['b'] }] },
        tree: { anyOf: [{ type: 'object', properties: { x: { type: 'string' } } }, { type: 'string' }] },
      },
    };
    expect(scalarLeaves(vrf)).toEqual([
      expect.objectContaining({ path: 'table', kind: 'integer' }),
      expect.objectContaining({ path: 'mode', kind: 'enum' }),
    ]);
  });
});

describe('leafLabel', () => {
  it('prefers titles, prettifies keys', () => {
    expect(leafLabel('type', { title: 'Kind' })).toBe('Kind');
    expect(leafLabel('link/auto-negotiate')).toBe('Auto negotiate');
    expect(leafLabel('mac-address')).toBe('MAC address');
    expect(leafLabel('dhcp-relay6')).toBe('DHCP relay6');
    expect(leafLabel('ospf6')).toBe('OSPF6');
    expect(leafLabel('sflow')).toBe('sFlow');
  });
});

describe('toIncludePatterns', () => {
  it('prefixes collection members, keeps item pointers root-relative', () => {
    expect(toIncludePatterns('/interface', ['type', 'link/speed'])).toEqual(['/*/type', '/*/link/speed']);
    expect(toIncludePatterns('/interface/{interface-id}', ['type'])).toEqual(['/type']);
  });

  it('drops duplicates (picked fields + always-fetched adapter leaves)', () => {
    expect(toIncludePatterns('/interface', ['type', 'link/state', 'type'])).toEqual([
      '/*/type',
      '/*/link/state',
    ]);
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
      ['link/mtu', 'number', 'MTU'],
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

describe('enableGates', () => {
  it('gates siblings under each toggle, outermost first', () => {
    const gates = enableGates(['enable', 'dad/enable', 'dad/max-moves', 'vxlan/port', 'enable-x']);
    expect(gates.get('dad/enable')).toEqual(['enable']);
    expect(gates.get('dad/max-moves')).toEqual(['enable', 'dad/enable']);
    expect(gates.get('vxlan/port')).toEqual(['enable']);
    expect(gates.has('enable')).toBe(false);
  });

  it('leaves paths outside a nested toggle ungated', () => {
    const gates = enableGates(['vxlan/enable', 'vxlan/port', 'vxlan/mtu', 'mac-address']);
    expect(gates.get('vxlan/port')).toEqual(['vxlan/enable']);
    expect(gates.get('vxlan/mtu')).toEqual(['vxlan/enable']);
    expect(gates.has('mac-address')).toBe(false);
  });
});

describe('sectionsOf', () => {
  it('lists object children as sections, skipping @actions and on/off enums', () => {
    const { sections, leaves } = sectionsOf({
      properties: {
        bgp: { type: 'object', properties: { enable: { type: 'string', enum: ['on', 'off'] } } },
        policy: { type: 'object', additionalProperties: { type: 'object' } },
        hostname: { type: 'string' },
        '@reboot': { type: 'object', properties: {} },
        flag: { type: 'object', enum: ['on', 'off', null] },
      },
    });
    expect(sections).toEqual(['bgp', 'policy']);
    expect(leaves.map((l) => l.path)).toEqual(['bgp/enable', 'hostname', 'flag']);
  });
});
