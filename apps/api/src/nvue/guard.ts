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
  /**
   * Extra NVUE query params (e.g. base_rev). Keys are allowlisted to safe
   * characters, values are bounded strings — never a back door around the gate.
   */
  params?: Record<string, string>;
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

const matcherCache = new WeakMap<object, Array<{ re: RegExp; methods: string[]; views: string[] }>>();

/**
 * NVUE paths are templates (`/interface/{interface-id}`); calls carry concrete
 * ids. Exact match first, then template match. Compiled once per manifest.
 */
function matchersFor(manifest: Pick<NvueManifest, 'routes' | 'views'>) {
  const cached = matcherCache.get(manifest);
  if (cached) return cached;
  const list = Object.entries(manifest.routes)
    .filter(([tmpl]) => tmpl.includes('{'))
    .map(([tmpl, methods]) => ({
      re: new RegExp(
        `^${tmpl
          .split('/')
          .map((seg) =>
            seg.startsWith('{') && seg.endsWith('}') ? '[^/]+' : seg.replace(/[/.*+?^${}()|[\]\\]/g, '\\$&'),
          )
          .join('/')}$`,
      ),
      methods,
      views: manifest.views[tmpl] ?? [],
    }));
  matcherCache.set(manifest, list);
  return list;
}

/** Validate a call against the manifest. Throws GuardError on any violation. */
export function guardCall(manifest: Pick<NvueManifest, 'routes' | 'views'>, call: GuardedCall): void {
  const { path, method } = call;
  if (!path.startsWith('/') || path.includes('..') || path.includes('\\') || path.includes('//')) {
    throw new GuardError(`bad path ${JSON.stringify(path)}`);
  }
  const direct = manifest.routes[path];
  const viaTemplate = direct === undefined ? matchersFor(manifest).find((m) => m.re.test(path)) : undefined;
  const allowed = direct ?? viaTemplate?.methods;
  if (!allowed) throw new GuardError(`unknown NVUE path ${JSON.stringify(path)}`);
  if (!allowed.includes(method.toLowerCase())) {
    throw new GuardError(`${method} not allowed on ${JSON.stringify(path)}`);
  }
  if (call.rev !== undefined && (typeof call.rev !== 'string' || call.rev.length === 0)) {
    throw new GuardError('rev must be a non-empty string');
  }
  if (call.view !== undefined) {
    const known = manifest.views[path] ?? viaTemplate?.views ?? [];
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
  if (call.params !== undefined) {
    if (!isPlainObject(call.params)) throw new GuardError('params must be a string map');
    for (const [k, v] of Object.entries(call.params)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(k) || typeof v !== 'string' || v.length === 0 || v.length > 256) {
        throw new GuardError(`bad query param ${JSON.stringify(k)}`);
      }
    }
  }
}
