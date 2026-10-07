import { describe, expect, it } from 'vitest';
import { planCalls, stageRounds, type PlanField } from './plan.js';

const field = (path: string, kind: PlanField['kind'], extra: Partial<PlanField> = {}): PlanField => ({
  path,
  label: path,
  kind,
  choices: [],
  perSwitch: false,
  invalid: () => null,
  ...extra,
});
const MTU = field('link/mtu', 'number', {
  invalid: (t) => (Number(t) > 9216 ? 'Must be at most 9216.' : null),
});
const STATE = field('link/state', 'keyed');
const ADDR = field('ip/address', 'set', { perSwitch: true });
const DESC = field('description', 'text');

const current = {
  a: { 'link/mtu': '9216', 'link/state': 'up', 'ip/address': '10.0.0.1/31', description: 'x' },
  b: { 'link/mtu': '1500', 'link/state': 'up', 'ip/address': '', description: 'y' },
};

describe('planCalls', () => {
  it('aligning a mixed value only touches switches that differ', () => {
    const plan = planCalls('/interface/swp1', ['a', 'b'], [MTU, DESC], current, { 'link/mtu': '9216' }, {});
    expect(plan).toEqual({
      ok: true,
      calls: { b: [{ path: '/interface/swp1', method: 'PATCH', body: { link: { mtu: 9216 } } }] },
      unchanged: ['a'],
    });
  });

  it('keeps mixed fields untouched, encodes keyed values, adds and removes per-switch set keys', () => {
    const plan = planCalls(
      '/interface/swp1',
      ['a', 'b'],
      [STATE, ADDR],
      current,
      { 'link/state': 'down' },
      { 'ip/address': { a: '10.0.0.5/31', b: '10.0.0.3/31' } },
    );
    expect(plan.ok && plan.calls).toEqual({
      a: [
        {
          path: '/interface/swp1',
          method: 'PATCH',
          body: {
            link: { state: { down: {} } },
            ip: { address: { '10.0.0.5/31': {}, '10.0.0.1/31': null } },
          },
        },
      ],
      b: [
        {
          path: '/interface/swp1',
          method: 'PATCH',
          body: { link: { state: { down: {} } }, ip: { address: { '10.0.0.3/31': {} } } },
        },
      ],
    });
  });

  it('clears with PATCH null, refuses invalid values and empty plans', () => {
    const cleared = planCalls('/interface/swp1', ['a'], [DESC], current, { description: '' }, {});
    expect(cleared.ok && cleared.calls.a).toEqual([
      { path: '/interface/swp1', method: 'PATCH', body: { description: null } },
    ]);
    expect(planCalls('/interface/swp1', ['a', 'b'], [MTU], current, { 'link/mtu': '10000' }, {})).toEqual({
      ok: false,
      error: 'link/mtu (a): Must be at most 9216.',
    });
    expect(planCalls('/interface/swp1', ['a'], [MTU], current, {}, {})).toEqual({
      ok: false,
      error: 'No changes to stage.',
    });
  });
});

describe('stageRounds', () => {
  it('groups same path+method, first call per member exclusive', () => {
    const rounds = stageRounds({
      a: [
        { path: '/interface/swp1', method: 'PATCH', body: { x: 1 } },
        { path: '/interface/swp1/ip/address/k', method: 'DELETE' },
      ],
      b: [{ path: '/interface/swp1', method: 'PATCH', body: { x: 2 } }],
    });
    expect(rounds).toEqual([
      {
        path: '/interface/swp1',
        method: 'PATCH',
        members: ['a', 'b'],
        exclusive: true,
        bodies: { a: { x: 1 }, b: { x: 2 } },
      },
      { path: '/interface/swp1/ip/address/k', method: 'DELETE', members: ['a'], exclusive: false },
    ]);
  });
});
