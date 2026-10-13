import { describe, expect, it } from 'vitest';
import { cliToken, configYaml, diffCommands, toCommands, toYaml, yamlTokens } from './nvconfig.js';

const tree = {
  interface: {
    swp1: {
      description: 'Just a description',
      ip: { address: { '10.0.0.1/31': {} } },
      link: { mtu: 9216, state: { up: {} } },
      type: 'swp',
    },
  },
  system: { hostname: 'leaf01', 'auto-save': { enable: 'on' } },
  vrf: { mgmt: { table: 1001 } },
};

describe('toCommands', () => {
  it('emits one nv set line per leaf and per empty member', () => {
    expect(toCommands(tree)).toEqual([
      "nv set interface swp1 description 'Just a description'",
      'nv set interface swp1 ip address 10.0.0.1/31',
      'nv set interface swp1 link mtu 9216',
      'nv set interface swp1 link state up',
      'nv set interface swp1 type swp',
      'nv set system hostname leaf01',
      'nv set system auto-save enable on',
      'nv set vrf mgmt table 1001',
    ]);
  });

  it('quotes unsafe tokens', () => {
    expect(cliToken('536-65535')).toBe('536-65535');
    expect(cliToken("it's")).toBe(`'it'\\''s'`);
    expect(cliToken('')).toBe("''");
  });
});

describe('toYaml', () => {
  it('renders nested maps, empty members and quoted scalars', () => {
    expect(toYaml({ a: { b: 1, c: {}, d: '25.0', e: 'on', f: 'two words', g: 'a: b' } })).toEqual([
      'a:',
      '  b: 1',
      '  c: {}',
      "  d: '25.0'",
      '  e: on',
      '  f: two words',
      "  g: 'a: b'",
    ]);
  });

  it('splits the revision header out like nv config show', () => {
    const rev = { header: { model: 'vx', 'rev-id': 1 }, system: { hostname: 'leaf01' } };
    expect(configYaml(rev)).toEqual([
      '- header:',
      '    model: vx',
      '    rev-id: 1',
      '- set:',
      '    system:',
      '      hostname: leaf01',
    ]);
    expect(toCommands(rev)).toEqual(['nv set system hostname leaf01']);
  });

  it('wraps a revision in the nv config show document', () => {
    expect(configYaml({ system: { hostname: 'leaf01' } })).toEqual([
      '- set:',
      '    system:',
      '      hostname: leaf01',
    ]);
  });
});

describe('diffCommands', () => {
  it('lists removed then added lines', () => {
    expect(diffCommands(['a', 'b', 'c'], ['a', 'c', 'd'])).toEqual([
      { op: '-', line: 'b' },
      { op: '+', line: 'd' },
    ]);
  });
});

describe('yamlTokens', () => {
  const kinds = (line: string) => yamlTokens(line).map((t) => [t.text, t.kind]);
  it('splits keys, punctuation and typed scalars; tokens rebuild the line', () => {
    expect(kinds('- set:')).toEqual([
      ['- ', 'punct'],
      ['set', 'key'],
      [':', 'punct'],
    ]);
    expect(kinds('      mtu: 9216')).toEqual([
      ['      ', 'text'],
      ['mtu', 'key'],
      [':', 'punct'],
      [' ', 'text'],
      ['9216', 'number'],
    ]);
    expect(kinds("    description: 'Just a description'").slice(-1)).toEqual([
      ["'Just a description'", 'string'],
    ]);
    expect(kinds('    enable: on').slice(-1)).toEqual([['on', 'text']]);
    expect(kinds('    flag: true').slice(-1)).toEqual([['true', 'keyword']]);
    expect(kinds('    up: {}').slice(-1)).toEqual([['{}', 'punct']]);
    // Plain keys may hold colons (IPv6); the key ends at the last ":" before space or end.
    expect(kinds('        fe80::1/64: {}').slice(1, 3)).toEqual([
      ['fe80::1/64', 'key'],
      [':', 'punct'],
    ]);
    expect(kinds("        '10': {}").slice(1, 2)).toEqual([["'10'", 'key']]);
    expect(kinds('      - swp1')).toEqual([
      ['      ', 'text'],
      ['- ', 'punct'],
      ['swp1', 'text'],
    ]);
    for (const line of ['- header:', "  x: 'a: b'", '      - swp1', '    a:  spaced  ']) {
      expect(
        yamlTokens(line)
          .map((t) => t.text)
          .join(''),
      ).toBe(line);
    }
  });
});
