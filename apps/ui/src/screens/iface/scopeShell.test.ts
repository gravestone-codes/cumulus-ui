import { describe, expect, it } from 'vitest';
import { draftAge } from './ScopeShell.js';

const NOW = Date.parse('2026-10-11T12:00:00.000Z');

describe('draftAge', () => {
  it('says just now under a minute', () => {
    expect(draftAge('2026-10-11T11:59:30.000Z', NOW)).toBe('just now');
  });

  it('rounds down to minutes, hours, days', () => {
    expect(draftAge('2026-10-11T11:55:00.000Z', NOW)).toBe('5m ago');
    expect(draftAge('2026-10-11T09:00:00.000Z', NOW)).toBe('3h ago');
    expect(draftAge('2026-10-09T12:00:00.000Z', NOW)).toBe('2d ago');
  });

  it('is empty for garbage or the future', () => {
    expect(draftAge('not-a-date', NOW)).toBe('');
    expect(draftAge('2026-10-11T12:00:01.000Z', NOW)).toBe('');
  });
});
