/**
 * Table pipeline unit tests: sort cycling (the reported reverse bug),
 * search, per-column filter ops, and pagination clamping.
 */
import { describe, expect, it } from 'vitest';
import { applySearchFilterSort, cycleSort, paginateRows, type TableColumn } from './table.js';

interface Row {
  name: string;
  state: string;
}

const COLS = new Map<string, TableColumn<Row>>([
  ['name', { key: 'name', value: (r) => r.name }],
  ['state', { key: 'state', value: (r) => r.state }],
]);
const KEYS = ['name', 'state'];
const ROWS: Row[] = [
  { name: 'swp2', state: 'up' },
  { name: 'eth0', state: 'up' },
  { name: 'swp1', state: 'down' },
  { name: 'lo', state: 'up' },
];

describe('cycleSort', () => {
  it('cycles asc → desc → off per column', () => {
    expect(cycleSort(null, 'name')).toEqual({ key: 'name', dir: 'asc' });
    expect(cycleSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(cycleSort({ key: 'name', dir: 'desc' }, 'name')).toBeNull();
    expect(cycleSort({ key: 'name', dir: 'desc' }, 'state')).toEqual({ key: 'state', dir: 'asc' });
  });
});

describe('applySearchFilterSort', () => {
  it('sorts ascending then descending (reverse applies)', () => {
    const asc = applySearchFilterSort(ROWS, COLS, KEYS, '', {}, { key: 'name', dir: 'asc' });
    expect(asc.map((r) => r.name)).toEqual(['eth0', 'lo', 'swp1', 'swp2']);
    const desc = applySearchFilterSort(ROWS, COLS, KEYS, '', {}, { key: 'name', dir: 'desc' });
    expect(desc.map((r) => r.name)).toEqual(['swp2', 'swp1', 'lo', 'eth0']);
    expect(desc).not.toEqual(asc);
  });

  it('searches visible columns only', () => {
    const hit = applySearchFilterSort(ROWS, COLS, KEYS, 'swp', {}, null);
    expect(hit.map((r) => r.name)).toEqual(['swp2', 'swp1']);
    const hidden = applySearchFilterSort(ROWS, COLS, ['name'], 'up', {}, null);
    expect(hidden).toEqual([]);
  });

  it('applies column filter ops', () => {
    const is = applySearchFilterSort(
      ROWS,
      COLS,
      KEYS,
      '',
      { state: { op: 'is', value: 'up', values: [] } },
      null,
    );
    expect(is.map((r) => r.name)).toEqual(['swp2', 'eth0', 'lo']);
    const not = applySearchFilterSort(
      ROWS,
      COLS,
      KEYS,
      '',
      { state: { op: 'isNot', value: 'up', values: [] } },
      null,
    );
    expect(not.map((r) => r.name)).toEqual(['swp1']);
    const oneOf = applySearchFilterSort(
      ROWS,
      COLS,
      KEYS,
      '',
      { name: { op: 'isOneOf', value: '', values: ['lo', 'eth0'] } },
      null,
    );
    expect(oneOf.map((r) => r.name)).toEqual(['eth0', 'lo']);
  });
});

describe('paginateRows', () => {
  it('slices and clamps out-of-range pages', () => {
    const items = [1, 2, 3, 4, 5];
    expect(paginateRows(items, 1, 2)).toMatchObject({ pageItems: [1, 2], totalPages: 3, page: 1, start: 0 });
    expect(paginateRows(items, 3, 2)).toMatchObject({ pageItems: [5], page: 3, start: 4 });
    expect(paginateRows(items, 9, 2)).toMatchObject({ pageItems: [5], page: 3 });
    expect(paginateRows([], 1, 10)).toMatchObject({ pageItems: [], totalPages: 1 });
  });
});
