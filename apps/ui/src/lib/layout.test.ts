import { describe, expect, it } from 'vitest';
import { moveWidget } from './layout.js';

describe('moveWidget', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('drops forward after the target and backward before it', () => {
    expect(moveWidget(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveWidget(ids, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });
  it('swaps neighbours (arrow moves)', () => {
    expect(moveWidget(ids, 'b', 'c')).toEqual(['a', 'c', 'b', 'd']);
    expect(moveWidget(ids, 'c', 'b')).toEqual(['a', 'c', 'b', 'd']);
  });
  it('ignores no-ops and unknown ids', () => {
    expect(moveWidget(ids, 'a', 'a')).toBe(ids);
    expect(moveWidget(ids, 'x', 'a')).toBe(ids);
  });
});
