/**
 * Split the vendored NVUE spec into per-domain documents (roadmap: one code path
 * per object identity; codegen follows the same domain boundaries as the UI slices).
 * Shared definitions (x-defs, components) are kept whole in every split so $refs resolve.
 * Run via `pnpm codegen` before orval. Output goes to build/spec/ (gitignored, reproducible).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const root = join(dir, '..');
const outDir = join(root, 'build', 'spec');

interface NvueDoc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
  paths?: Record<string, unknown>;
}

/** Top-level segment of a path: `/vrf/{id}/router/bgp` → `vrf`, `/` → `root`. */
export function topSegment(path: string): string {
  if (path === '/') return 'root';
  return path.slice(1).split('/')[0] ?? 'root';
}

/** Group paths by top segment. Pure — unit-testable without the 7MB fixture. */
export function groupPaths(paths: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const groups: Record<string, Record<string, unknown>> = {};
  for (const [path, ops] of Object.entries(paths)) {
    const seg = topSegment(path);
    groups[seg] ??= {};
    groups[seg][path] = ops;
  }
  return groups;
}

const doc = JSON.parse(readFileSync(join(root, 'openapi.json'), 'utf8')) as NvueDoc;
const { paths, ...shared } = doc;
const groups = groupPaths(paths ?? {});
mkdirSync(outDir, { recursive: true });
for (const [seg, segPaths] of Object.entries(groups)) {
  writeFileSync(join(outDir, `openapi.${seg}.json`), JSON.stringify({ ...shared, paths: segPaths }));
}
console.log(`split: ${Object.keys(groups).length} domains → build/spec/`);
