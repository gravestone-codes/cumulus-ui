import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.js';

describe('parseCsv', () => {
  it('parses rows with and without groups, skips comments and blanks', () => {
    const { rows, error } = parseCsv('# c\n\na,b,https://x,u,p\nc,d,https://y,u2,p2,G\n');
    expect(error).toBeNull();
    expect(rows).toEqual([
      { id: 'a', display_name: 'b', base_url: 'https://x', switch_username: 'u', switch_password: 'p' },
      {
        id: 'c',
        display_name: 'd',
        base_url: 'https://y',
        switch_username: 'u2',
        switch_password: 'p2',
        group: 'G',
      },
    ]);
  });

  it('rejects short lines, empties, and oversize imports', () => {
    expect(parseCsv('a,b,c').error).toContain('bad line');
    expect(parseCsv('').error).toBe('nothing to import');
    expect(parseCsv(Array.from({ length: 201 }, (_, i) => `s${i},d,https://x,u,p`).join('\n')).error).toBe(
      'max 200 rows per import',
    );
  });
});
