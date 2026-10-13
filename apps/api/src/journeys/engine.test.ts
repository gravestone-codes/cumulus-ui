/**
 * Journey engine unit tests: ref filling, input validation, check grading and
 * step transitions — the decisions, without a database or a switch.
 */
import { describe, expect, it } from 'vitest';
import { journeyOf, type Journey, type JourneyStep } from './catalog.js';
import {
  captureFrom,
  evaluate,
  gatedCalls,
  network,
  planCalls,
  recordCheck,
  RefError,
  resolveBody,
  resolvePath,
  startRun,
  validateInputs,
  moveOn,
  type Evidence,
  type RunState,
} from './engine.js';

const NOW = '2026-10-13T12:00:00.000Z';
const vrf = journeyOf('vrf-bringup') as Journey;
const leak = journeyOf('route-leak') as Journey;
const input = (j: Journey, id: string) =>
  j.steps.find((s) => s.id === id) as Extract<JourneyStep, { kind: 'input' }>;
const pass = (sw = 'leaf01'): Evidence => ({ switchId: sw, path: '/x', ok: true, lines: [] });
const fail = (sw = 'leaf01'): Evidence => ({
  switchId: sw,
  path: '/x',
  ok: false,
  lines: [{ ok: false, text: 'x missing' }],
});

describe('refs', () => {
  it('paths encode each ref as one segment; missing refs throw', () => {
    expect(
      resolvePath('/vrf/{{a.v}}/router/rib/ipv4/route/{{a.p}}', { 'a.v': 'RED', 'a.p': '10.1.0.0/16' }),
    ).toBe('/vrf/RED/router/rib/ipv4/route/10.1.0.0%2F16');
    expect(resolvePath('/interface/vlan{{a.vid}}', { 'a.vid': 10 })).toBe('/interface/vlan10');
    expect(() => resolvePath('/vrf/{{a.v}}', {})).toThrow(RefError);
  });

  it('bodies keep types, expand list keys and drop empty optionals', () => {
    expect(
      resolveBody(
        {
          vlan: '{{a.vid}}',
          description: '{{a.desc}}',
          bond: { member: { '{{a.m}}': {} } },
          ip: { vrf: 'x{{a.v}}' },
        },
        { 'a.vid': 10, 'a.m': ['swp1', 'swp2'], 'a.v': 'RED' },
      ),
    ).toEqual({ vlan: 10, bond: { member: { swp1: {}, swp2: {} } }, ip: { vrf: 'xRED' } });
  });

  it('plans repeat `each` calls per item', () => {
    const calls = planCalls(
      [{ method: 'PATCH', path: '/interface/{{item}}/link', body: { state: { up: {} } }, each: 'a.m' }],
      { 'a.m': ['swp1', 'swp2'] },
    );
    expect(calls.map((c) => c.path)).toEqual(['/interface/swp1/link', '/interface/swp2/link']);
  });
});

describe('inputs', () => {
  it('validates, applies defaults and derives the network', () => {
    const ok = validateInputs(input(vrf, 'vrf'), { name: 'RED', vid: '10', gateway: '10.1.10.1/24' });
    expect(ok).toEqual({
      values: { name: 'RED', vid: 10, gateway: '10.1.10.1/24', bridge: 'br_default', net: '10.1.10.0/24' },
    });
  });

  it('reports every bad field at once', () => {
    const bad = validateInputs(input(vrf, 'vrf'), { name: '9bad', vid: '5000', gateway: '10.1.300.1/24' });
    expect('errors' in bad && Object.keys(bad.errors).sort()).toEqual(['gateway', 'name', 'vid']);
  });

  it('requiredWhen makes a field mandatory only for its trigger value', () => {
    const fix = input(leak, 'fix');
    expect(validateInputs(fix, { remedy: 'remove-import' })).toEqual({ values: { remedy: 'remove-import' } });
    expect(validateInputs(fix, { remedy: 'route-map' })).toEqual({ errors: { routemap: 'Required.' } });
    expect(validateInputs(fix, { remedy: 'nope' })).toMatchObject({ errors: { remedy: expect.any(String) } });
  });

  it('network masks host bits', () => {
    expect(network('10.1.10.77/24')).toBe('10.1.10.0/24');
    expect(network('192.168.5.9/32')).toBe('192.168.5.9/32');
    expect(network('10.255.255.255/8')).toBe('10.0.0.0/8');
  });
});

describe('checks', () => {
  const route = {
    'route-entry': {
      '1': { protocol: 'bgp', 'via-entry': { '10.0.0.1': { vrf: 'BLUE' } } },
      '2': { protocol: 'connected', 'via-entry': { vlan10: { vrf: 'RED' } } },
    },
  };

  it('grades exists / equals / absent, honouring except', () => {
    const lines = evaluate(
      [
        { at: 'route-entry/*/protocol', op: 'equals', value: 'connected' },
        { at: 'route-entry/*/via-entry/*/vrf', op: 'exists', except: '{{l.vrf}}' },
        { at: 'route-entry/*/via-entry/*/vrf', op: 'absent', except: '{{l.vrf}}' },
      ],
      route,
      { 'l.vrf': 'RED' },
    );
    expect(lines.map((l) => l.ok)).toEqual([true, true, false]);
    expect(lines[2]?.text).toContain('BLUE');
  });

  it('an absent path (404) passes absent and fails exists', () => {
    expect(evaluate([{ at: '', op: 'absent' }], undefined, {})[0]?.ok).toBe(true);
    expect(evaluate([{ at: '*', op: 'exists' }], undefined, {})[0]?.ok).toBe(false);
    expect(evaluate([{ at: '*', op: 'exists' }], {}, {})[0]?.ok).toBe(false);
  });

  it('captures the first value, skipping except', () => {
    expect(
      captureFrom({ source: { at: 'route-entry/*/via-entry/*/vrf', except: 'BLUE' } }, route, {}),
    ).toEqual({ source: 'RED' });
  });
});

describe('transitions', () => {
  it('skips steps whose when fails and finishes after the last', () => {
    let run = startRun(vrf, NOW);
    expect(run.current).toBe('vrf');
    run = { ...run, values: { 'vrf.name': 'RED' } }; // no vni
    run = moveOn(
      vrf,
      run,
      vrf.steps.findIndex((s) => s.id === 'bgp'),
      NOW,
    );
    expect(run.current).toBe('routes');
    expect(run.steps.evpn?.status).toBe('skipped');
    run = recordCheck(vrf, run, 'routes', [pass()], {}, NOW);
    expect(run).toMatchObject({ state: 'done', current: null });
  });

  it('a failing check blocks in place; passing later moves on', () => {
    let run: RunState = { ...startRun(vrf, NOW), current: 'create', values: { 'vrf.name': 'RED' } };
    run = recordCheck(vrf, run, 'create', [pass('a'), fail('b')], {}, NOW);
    expect(run).toMatchObject({ state: 'blocked', current: 'create' });
    run = recordCheck(vrf, run, 'create', [pass('a'), pass('b')], {}, NOW);
    expect(run).toMatchObject({ state: 'in-progress', current: 'svi' });
  });

  it('no evidence never passes', () => {
    const run = recordCheck(vrf, { ...startRun(vrf, NOW), current: 'create' }, 'create', [], {}, NOW);
    expect(run.state).toBe('blocked');
  });

  it('onFail branches: a missing prefix ends the leak journey with its note', () => {
    const run = recordCheck(
      leak,
      {
        ...startRun(leak, NOW),
        current: 'present',
        values: { 'leak.vrf': 'RED', 'leak.net': '10.9.0.0/16' },
      },
      'present',
      [fail()],
      {},
      NOW,
    );
    expect(run).toMatchObject({ state: 'done', current: null });
    expect(run.note).toBe('10.9.0.0/16 is not in RED — nothing is leaking here.');
    expect(run.steps.present?.status).toBe('branched');
  });

  it('an unreadable check blocks instead of branching', () => {
    const unread: Evidence = {
      switchId: 'leaf01',
      path: '/x',
      ok: false,
      lines: [],
      error: 'not granted by any role',
    };
    const run = recordCheck(
      leak,
      {
        ...startRun(leak, NOW),
        current: 'present',
        values: { 'leak.vrf': 'RED', 'leak.net': '10.9.0.0/16' },
      },
      'present',
      [unread],
      {},
      NOW,
    );
    expect(run).toMatchObject({ state: 'blocked', current: 'present', note: null });
  });

  it('captures land namespaced and steer later steps', () => {
    let run: RunState = { ...startRun(leak, NOW), current: 'exporter', values: { 'leak.vrf': 'RED' } };
    run = recordCheck(leak, run, 'exporter', [pass()], { source: 'BLUE' }, NOW);
    expect(run.values['exporter.source']).toBe('BLUE');
    expect(run.current).toBe('import');
    run = recordCheck(leak, run, 'import', [pass()], {}, NOW);
    run = { ...run, values: { ...run.values, 'fix.remedy': 'remove-import' } };
    run = moveOn(
      leak,
      run,
      leak.steps.findIndex((s) => s.id === 'fix'),
      NOW,
    );
    expect(run.current).toBe('unimport');
    run = recordCheck(leak, run, 'unimport', [pass()], {}, NOW);
    expect(run.current).toBe('gone');
    expect(run.steps.routemap?.status).toBe('skipped');
    expect(run.steps.filter?.status).toBe('skipped');
  });
});

describe('gatedCalls', () => {
  it('lists every write and read with refs blanked', () => {
    const calls = gatedCalls(vrf);
    expect(calls).toContainEqual({ step: 'Create the VRF', method: 'PATCH', path: '/vrf/_' });
    expect(calls).toContainEqual({ step: 'SVI and gateway', method: 'GET', path: '/interface/vlan_' });
  });
});
