/** CLI: writes manifest.json next to openapi.json. Run via `pnpm manifest`. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../src/manifest.js';

const dir = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(dir, '..', 'openapi.json'), 'utf8'));
const manifest = buildManifest(doc);
writeFileSync(join(dir, '..', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(
  `manifest: ${manifest.pathCount} paths, ${Object.keys(manifest.topSegments).length} segments → manifest.json`,
);
