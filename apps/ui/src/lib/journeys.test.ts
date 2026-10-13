import { describe, expect, it } from 'vitest';
import { callCommands, perMember, railOf } from './journeys.js';
import type { JourneyRun } from './api.js';

describe('callCommands', () => {
  it('renders writes as the CLI lines they amount to', () => {
    expect(callCommands({ method: 'PATCH', path: '/vrf/RED', body: { table: 'auto' } })).toEqual([
      'nv set vrf RED table auto',
    ]);
    expect(callCommands({ method: 'PATCH', path: '/bridge/domain/br_default/vlan/10', body: {} })).toEqual([
      'nv set bridge domain br_default vlan 10',
    ]);
    expect(
      callCommands({
        method: 'PATCH',
        path: '/interface/vlan10',
        body: { ip: { address: { '10.1.10.1/24': {} } } },
      }),
    ).toEqual(['nv set interface vlan10 ip address 10.1.10.1/24']);
    expect(callCommands({ method: 'DELETE', path: '/vrf/RED/router/rib/ipv4/route/10.0.0.0%2F8' })).toEqual([
      'nv unset vrf RED router rib ipv4 route 10.0.0.0/8',
    ]);
  });
});

describe('railOf', () => {
  const run = {
    current: 'b',
    steps: { a: { status: 'done', at: '' }, b: { status: 'blocked', at: '' } },
  } as unknown as JourneyRun;
  it('marks recorded, current (or blocked) and pending steps', () => {
    const steps = ['a', 'b', 'c'].map((id) => ({
      id,
      title: id.toUpperCase(),
      help: '',
      kind: 'verify' as const,
    }));
    expect(railOf(steps, run).map((r) => r.status)).toEqual(['done', 'blocked', 'pending']);
    expect(railOf(steps, { ...run, steps: { a: { status: 'done', at: '' } } }).map((r) => r.status)).toEqual([
      'done',
      'current',
      'pending',
    ]);
  });
});

describe('perMember', () => {
  it('mirrors the plan on every member', () => {
    const plan = [{ method: 'PATCH' as const, path: '/vrf/RED', body: {} }];
    expect(perMember(plan, ['a', 'b'])).toEqual({ a: plan, b: plan });
  });
});
