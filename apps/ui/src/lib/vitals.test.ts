import { describe, expect, it } from 'vitest';
import { parsePorts, parseVitals, uptimeText } from './vitals.js';

// Shapes as Cumulus 5.14 returns them (trimmed from a lab switch).
const system = {
  hostname: 'cumulus',
  uptime: 644735,
  'system-memory': '1.41 GB used / 1.18 GB free / 3.45 GB total',
  version: { 'product-release': '5.14.0' },
};
const health = {
  status: 'Not OK',
  issues: {
    ASIC: { issue: 'Not OK' },
    forwarding: { issue: 'active (running) since Mon 2026-10-05 13:41:32 UTC; 1 week 0 days ago' },
    'hw-management': { issue: 'inactive' },
  },
};

describe('parseVitals', () => {
  it('reads system, load, health and sensors', () => {
    const v = parseVitals({
      system,
      cpu: { 'core-count': 2, utilization: 0.2 },
      memory: { Physical: { utilization: 40.86 } },
      health,
      env: {
        'FAN1/1': { state: 'ok', type: 'fan' },
        PSU1: { state: 'failed', type: 'psu' },
        'Board-Sensor-near-CPU': { state: 'ok', type: 'temperature' },
        FAN: { state: 'green', type: 'led' },
      },
      temps: { 'Board-Sensor-near-CPU': { crit: 85, current: '25.0', max: 80, min: 5, state: 'ok' } },
    });
    expect(v).toMatchObject({
      hostname: 'cumulus',
      version: '5.14.0',
      uptime: 644735,
      cpu: 0.2,
      memory: 40.86,
    });
    expect(v.health).toMatchObject({ ok: false, status: 'Not OK' });
    expect(v.health?.issues.map((i) => [i.name, i.ok])).toEqual([
      ['ASIC', false],
      ['forwarding', true],
      ['hw-management', false],
    ]);
    const byName = Object.fromEntries(v.sensors.map((s) => [s.name, s]));
    expect(byName['PSU1']?.ok).toBe(false);
    expect(byName['FAN']?.ok).toBe(true);
    expect(byName['Board-Sensor-near-CPU']).toMatchObject({ current: 25, max: 80, crit: 85 });
  });

  it('leaves unread parts undefined, never zero', () => {
    const v = parseVitals({});
    expect(v.cpu).toBeUndefined();
    expect(v.memory).toBeUndefined();
    expect(v.health).toBeUndefined();
    expect(v.sensors).toEqual([]);
  });
});

describe('parsePorts', () => {
  it('classifies state, sums counters, skips plumbing', () => {
    const rows = parsePorts('leaf01', {
      lo: { type: 'loopback', link: { 'oper-status': 'unknown' } },
      mgmt: { type: 'vrf' },
      swp1: {
        type: 'swp',
        link: {
          'admin-status': 'up',
          state: { up: {} },
          stats: {
            'in-bytes': 10,
            'out-bytes': 20,
            'in-errors': 1,
            'out-errors': 2,
            'in-drops': 3,
            'out-drops': 0,
          },
        },
      },
      swp2: { type: 'swp', link: { 'admin-status': 'down', state: { down: {} } } },
      swp3: { type: 'swp', link: { 'admin-status': 'up', 'oper-status': 'down' } },
    });
    expect(rows.map((r) => [r.name, r.state])).toEqual([
      ['swp1', 'up'],
      ['swp2', 'admin-down'],
      ['swp3', 'down'],
    ]);
    expect(rows[0]).toMatchObject({ sw: 'leaf01', inBytes: 10, outBytes: 20, errors: 3, drops: 3 });
  });
});

describe('uptimeText', () => {
  it('scales days, hours, minutes', () => {
    expect(uptimeText(644735)).toBe('7d 11h');
    expect(uptimeText(3 * 3600 + 120)).toBe('3h 2m');
    expect(uptimeText(540)).toBe('9m');
    expect(uptimeText(undefined)).toBe('—');
  });
});
