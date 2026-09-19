import { describe, expect, it } from 'vitest';
import { applyNoCheck, fixBareArrays, fixBareNullable, fixUnionMin, NOCHECK } from './postgen.js';

describe('postgen', () => {
  it('maps bare arrays to unknown-element arrays', () => {
    expect(fixBareArrays('a: zod.array()')).toBe('a: zod.array(zod.unknown())');
    expect(fixBareArrays('a: zod.array(zod.string())')).toBe('a: zod.array(zod.string())');
  });

  it('maps bare nullable to nullable unknown', () => {
    expect(fixBareNullable('v: zod.nullable()')).toBe('v: zod.unknown().nullable()');
    expect(fixBareNullable('v: zod.string().nullable()')).toBe('v: zod.string().nullable()');
  });

  it('moves union .min floors into a string-member refine', () => {
    expect(fixUnionMin('zod.union([zod.string()]).min(1)')).toBe(
      'zod.union([zod.string()]).refine((v) => v == null || typeof v !== "string" || v.length >= 1)',
    );
    expect(fixUnionMin('zod.string().min(1)')).toBe('zod.string().min(1)');
  });

  it('nocheck header is idempotent and the set is documented', () => {
    expect(applyNoCheck('const x = 1;').startsWith('// @ts-nocheck')).toBe(true);
    expect(applyNoCheck('// @ts-nocheck\nconst x = 1;')).toBe('// @ts-nocheck\nconst x = 1;');
    expect([...NOCHECK]).toEqual(['vrf']);
  });
});
