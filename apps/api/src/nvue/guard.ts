/**
 * InputGuard v1 (roadmap 0.7): manifest-driven request gate. Every proxied
 * NVUE call passes here first — unknown paths and disallowed methods never
 * reach a switch. Pure: no network, fully unit-tested.
 * Per-operation body schemas arrive with the domain slices (Phase 1+);
 * until then bodies are shape- and size-checked, never schema-validated.
 */
import type { NvueManifest } from '@cumulus/spec/src/manifest.js';

export type NvueMethod = 'GET' | 'PATCH' | 'DELETE' | 'POST';

export interface GuardedCall {
  path: string;
  method: NvueMethod;
  rev?: string;
  include?: string[];
  omit?: string[];
  view?: string;
  body?: unknown;
}

/** Thrown (→ 400) when a call fails the gate. Never carries secrets. */
export class GuardError extends Error {
  readonly status = 400;
  constructor(reason: string) {
    super(`rejected NVUE call: ${reason}`);
  }
}

const MAX_BODY_BYTES = 1_000_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Validate a call against the manifest. Throws GuardError on any violation. */
export function guardCall(manifest: Pick<NvueManifest, 'routes' | 'views'>, call: GuardedCall): void {
  const { path, method } = call;
  if (!path.startsWith('/') || path.includes('..') || path.includes('\\') || path.includes('//')) {
    throw new GuardError(`bad path ${JSON.stringify(path)}`);
  }
  const allowed = manifest.routes[path];
  if (!allowed) throw new GuardError(`unknown NVUE path ${JSON.stringify(path)}`);
  if (!allowed.includes(method.toLowerCase())) {
    throw new GuardError(`${method} not allowed on ${JSON.stringify(path)}`);
  }
  if (call.rev !== undefined && (typeof call.rev !== 'string' || call.rev.length === 0)) {
    throw new GuardError('rev must be a non-empty string');
  }
  if (call.view !== undefined) {
    const known = manifest.views[path] ?? [];
    if (!known.includes(call.view))
      throw new GuardError(`view ${JSON.stringify(call.view)} not supported on ${JSON.stringify(path)}`);
  }
  for (const field of ['include', 'omit'] as const) {
    const list = call[field];
    if (
      list !== undefined &&
      (!Array.isArray(list) || list.some((v) => typeof v !== 'string' || v.length === 0))
    ) {
      throw new GuardError(`${field} must be an array of non-empty strings`);
    }
  }
  if (call.body !== undefined) {
    if (!isPlainObject(call.body)) throw new GuardError('body must be a JSON object');
    if (Buffer.byteLength(JSON.stringify(call.body), 'utf8') > MAX_BODY_BYTES) {
      throw new GuardError('body exceeds 1MB');
    }
  }
}
