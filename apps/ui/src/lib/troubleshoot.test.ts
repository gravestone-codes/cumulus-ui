import { describe, expect, it } from 'vitest';
import {
  cidrContains,
  longestMatch,
  parseBgp,
  parseIp,
  parseLldp,
  parseMacs,
  parseNeighbors,
  parseRoutes,
  protocolCounts,
} from './troubleshoot.js';

describe('parseRoutes', () => {
  it('joins entries with their resolved next hops (lab switch shape)', () => {
    const rows = parseRoutes(
      {
        '0.0.0.0/0': {
          'route-entry': {
            '1': {
              distance: 255,
              flags: { 'fib-selected': {}, installed: {}, selected: {} },
              'flags-string': '*Si',
              metric: 8192,
              'nexthop-group-id': 19,
              protocol: 'kernel',
              uptime: '2026-10-05T13:41:34Z',
            },
          },
        },
        '10.98.252.0/25': {
          'route-entry': {
            '1': { distance: 0, flags: { installed: {} }, 'nexthop-group-id': 17, protocol: 'connected' },
          },
        },
      },
      {
        '17': { 'resolved-via': { eth0: { type: 'interface', vrf: 'mgmt' } } },
        '19': { 'resolved-via': {} },
      },
    );
    expect(rows.map((r) => [r.prefix, r.protocol, r.via, r.selected, r.installed])).toEqual([
      ['0.0.0.0/0', 'kernel', '—', true, true],
      ['10.98.252.0/25', 'connected', 'eth0', false, true],
    ]);
    expect(rows[0]).toMatchObject({ distance: 255, metric: 8192, flags: '*Si' });
  });

  it('falls back to via entries when the group is unresolved', () => {
    const rows = parseRoutes(
      {
        '10.1.0.0/16': {
          'route-entry': {
            '1': { protocol: 'bgp', 'via-entry': { '1': { via: '10.0.0.1', interface: 'swp1' } } },
          },
        },
      },
      {},
    );
    expect(rows[0]?.via).toBe('10.0.0.1 swp1');
  });

  it('tags rows with their VRF and counts protocols busiest first', () => {
    const entry = (protocol: string) => ({ 'route-entry': { '1': { protocol } } });
    const rows = [
      ...parseRoutes({ '10.0.0.0/8': entry('ospf'), '10.1.0.0/16': entry('ospf') }, {}, 'blue'),
      ...parseRoutes({ '0.0.0.0/0': entry('bgp') }, {}),
    ];
    expect(rows.map((r) => r.vrf)).toEqual(['blue', 'blue', 'default']);
    expect(protocolCounts(rows)).toEqual([
      { protocol: 'ospf', count: 2 },
      { protocol: 'bgp', count: 1 },
    ]);
  });
});

describe('longest-prefix lookup', () => {
  it('parses both families', () => {
    expect(parseIp('10.0.0.1')).toEqual({ v: 4, n: 167772161n });
    expect(parseIp('::1')).toEqual({ v: 6, n: 1n });
    expect(parseIp('fe80::1')?.v).toBe(6);
    expect(parseIp('300.1.1.1')).toBeNull();
    expect(parseIp('nope')).toBeNull();
  });

  it('matches containment and picks the most specific prefix', () => {
    expect(cidrContains('10.98.252.0/25', '10.98.252.31')).toBe(true);
    expect(cidrContains('10.98.252.0/25', '10.98.252.200')).toBe(false);
    expect(cidrContains('fe80::/64', 'fe80::5054:ff:fe04:8b5a')).toBe(true);
    const table = ['0.0.0.0/0', '10.98.252.0/25', '10.98.252.31/32', '::/0'];
    expect(longestMatch('10.98.252.31', table)).toBe('10.98.252.31/32');
    expect(longestMatch('10.98.252.40', table)).toBe('10.98.252.0/25');
    expect(longestMatch('8.8.8.8', table)).toBe('0.0.0.0/0');
    expect(longestMatch('2001:db8::1', table)).toBe('::/0');
    expect(longestMatch('8.8.8.8', ['10.0.0.0/8'])).toBeUndefined();
  });
});

describe('neighbor tables', () => {
  it('reads ARP/ND per interface, 404 members as empty', () => {
    const rows = parseNeighbors({
      eth0: {
        ipv4: { '10.98.252.1': { flag: {}, lladdr: '00:00:00:00:03:01', state: { reachable: {} } } },
        ipv6: { 'fe80::1': { flag: { 'is-router': {} }, lladdr: '9c:05:91:f1:06:fd', state: { stale: {} } } },
      },
      swp1: null,
    });
    expect(rows).toEqual([
      {
        iface: 'eth0',
        family: 'ipv4',
        ip: '10.98.252.1',
        mac: '00:00:00:00:03:01',
        state: 'reachable',
        router: false,
      },
      {
        iface: 'eth0',
        family: 'ipv6',
        ip: 'fe80::1',
        mac: '9c:05:91:f1:06:fd',
        state: 'stale',
        router: true,
      },
    ]);
  });

  it('reads MAC entries, skipping action nodes', () => {
    const rows = parseMacs({
      br_default: {
        '1': { mac: '44:38:39:00:00:01', vlan: 10, interface: 'swp1', 'entry-type': 'permanent', age: 30 },
        dynamic: { '@clear': {} },
      },
      br_other: null,
    });
    expect(rows).toEqual([
      {
        domain: 'br_default',
        mac: '44:38:39:00:00:01',
        vlan: 10,
        iface: 'swp1',
        type: 'permanent',
        age: 30,
        remote: '',
      },
    ]);
  });

  it('reads LLDP neighbors with management addresses', () => {
    const rows = parseLldp({
      swp1: {
        spine1: {
          chassis: { 'system-name': 'spine1', 'management-address-ipv4': { '192.0.2.1': {} } },
          port: { name: 'swp51' },
        },
      },
    });
    expect(rows).toEqual([
      { iface: 'swp1', id: 'spine1', system: 'spine1', port: 'swp51', mgmt: '192.0.2.1' },
    ]);
  });

  it('reads BGP peers with prefix counts summed across families', () => {
    const rows = parseBgp({
      default: {
        swp51: {
          state: 'established',
          'remote-as': 65100,
          'remote-hostname': 'spine1',
          uptime: 3600,
          'address-family': {
            'ipv4-unicast': { 'rx-prefix': 5, 'tx-prefix': 2 },
            'l2vpn-evpn': { 'rx-prefix': 10 },
          },
        },
        '10.0.0.9': { state: 'idle', 'remote-as': 'external', 'last-reset-reason': 'Waiting for peer OPEN' },
      },
      mgmt: null,
    });
    expect(rows.map((r) => [r.peer, r.established, r.remoteAs, r.rx, r.tx, r.lastReset])).toEqual([
      ['swp51', true, '65100', 15, 2, ''],
      ['10.0.0.9', false, 'external', undefined, undefined, 'Waiting for peer OPEN'],
    ]);
  });
});
