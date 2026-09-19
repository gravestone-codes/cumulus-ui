/**
 * Post-process orval output. Three mechanical incompatibilities between orval's
 * zod client and the NVUE spec, each verified by exact occurrence counts:
 * - bare `zod.array()` (spec arrays without `items`) → `zod.array(zod.unknown())`
 * - bare `zod.nullable()` → `zod.unknown().nullable()`
 * - `.min(N)` emitted onto a union (minLength on a oneOf) → `.refine()` that
 *   enforces the floor on string members and passes everything else through.
 * Runs as the last step of `pnpm codegen` (regeneration would otherwise undo it).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Rewrite bare `zod.array()` calls. Pure — everything else untouched. */
export function fixBareArrays(src: string): string {
  return src.replaceAll('zod.array()', 'zod.array(zod.unknown())');
}

/** Rewrite bare `zod.nullable()` calls. Pure. */
export function fixBareNullable(src: string): string {
  return src.replaceAll('zod.nullable()', 'zod.unknown().nullable()');
}

/** Move a `.min(N)` floor from a union onto its string members via refine. Pure. */
export function fixUnionMin(src: string): string {
  return src.replace(
    /\]\)\.min\((\d+)\)/g,
    ']).refine((v) => v == null || typeof v !== "string" || v.length >= $1)',
  );
}

/** Apply all fixes to every generated domain file. Returns files changed. */
export function fixGenerated(generatedDir: string): number {
  let changed = 0;
  for (const seg of readdirSync(generatedDir)) {
    const file = join(generatedDir, seg, 'nvue.zod.ts');
    try {
      const before = readFileSync(file, 'utf8');
      let after = fixUnionMin(fixBareNullable(fixBareArrays(before)));
      if (NOCHECK.has(seg)) after = applyNoCheck(after);
      if (after !== before) {
        writeFileSync(file, after);
        changed++;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      /* segment without output — nothing to fix */
    }
  }
  return changed;
}

/**
 * Segments whose schemas exceed tsc's instantiation depth (TS2589) no matter
 * what: entire nested config trees in single expressions. Empirical — re-check
 * on spec/orval upgrades by running the spec typecheck and reading the codes.
 */
export const NOCHECK = new Set(['vrf']);

const NOCHECK_HEADER =
  '// @ts-nocheck — orval output exceeds tsc instantiation depth (TS2589); ' +
  'verified by parse + runtime tests instead. See scripts/postgen.ts NOCHECK.\n';

/** Prepend the nocheck header unless already present. Pure. */
export function applyNoCheck(src: string): string {
  return src.startsWith('// @ts-nocheck') ? src : NOCHECK_HEADER + src;
}

if (process.argv[1]?.endsWith('postgen.ts') ?? false) {
  const dir = join(new URL('.', import.meta.url).pathname, '..', 'src', 'generated');
  console.log(`postgen: fixed ${fixGenerated(dir)} files`);
}
