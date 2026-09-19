import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'orval';

/**
 * One zod-client target per domain split (see scripts/split-spec.ts).
 * `pnpm codegen` splits first, so build/spec/ always exists here.
 */
const specDir = './build/spec';
const targets: Record<string, object> = {};
// NOTE: `root` (the `/` whole-config mega-object) is skipped — its single schema
// explodes tsc's instantiation depth (TS2589) and nothing consumes it yet.
// Re-add by deleting this condition (one line) when a slice needs it.
const SKIP = new Set(['root']);
for (const file of readdirSync(specDir).sort()) {
  if (!file.startsWith('openapi.') || !file.endsWith('.json')) continue;
  const seg = file.slice('openapi.'.length, -'.json'.length);
  if (SKIP.has(seg)) continue;
  targets[seg] = {
    input: join(specDir, file),
    output: {
      target: `./src/generated/${seg}/nvue.zod.ts`,
      client: 'zod',
      mode: 'single',
    },
  };
}

export default defineConfig(targets);
