/**
 * Field descriptors for schema-driven forms (Phase 2: ResourceForm input).
 * Reads the vendored OpenAPI document (not the zod clients): finds the
 * requestBody schema for a path template + method, dereferences local $refs
 * (depth-capped, cycle-safe), and returns plain JSON Schema the dumb UI
 * renders without hand-written forms. Single source: openapi.json.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Doc {
  paths?: Record<string, Record<string, { requestBody?: unknown }>>;
  [key: string]: unknown;
}

let cached: Doc | null = null;

/** The vendored document, loaded once. Tries dev layout, then the image path. */
export function specDoc(): Doc {
  if (!cached) {
    const dir = dirname(fileURLToPath(import.meta.url));
    const candidates = [
      join(dir, '..', '..', '..', '..', 'packages', 'spec', 'openapi.json'),
      '/app/openapi.json',
    ];
    let lastErr: unknown;
    for (const file of candidates) {
      try {
        cached = JSON.parse(readFileSync(file, 'utf8')) as Doc;
        return cached;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
  return cached;
}

const MAX_DEPTH = 10;

/** Resolve local refs (#/x-defs/..., #/components/...) with cycle protection; depth counts ref hops. */
export function dereference(node: unknown, doc: Doc, depth = 0, seen: string[] = []): unknown {
  if (depth > MAX_DEPTH) return {};
  if (Array.isArray(node)) return node.map((v) => dereference(v, doc, depth, seen));
  if (typeof node !== 'object' || node === null) return node;
  const obj = node as Record<string, unknown>;
  const ref = obj['$ref'];
  if (typeof ref === 'string' && ref.startsWith('#/')) {
    if (seen.includes(ref)) return {};
    const target = ref
      .slice(2)
      .split('/')
      .reduce<unknown>(
        (acc, seg) =>
          typeof acc === 'object' && acc !== null ? (acc as Record<string, unknown>)[seg] : undefined,
        doc,
      );
    if (target === undefined) return {};
    const { $ref: _dropped, ...siblings } = obj;
    void _dropped;
    const resolved = dereference(target, doc, depth + 1, [...seen, ref]);
    if (typeof resolved === 'object' && resolved !== null && !Array.isArray(resolved)) {
      const rest = dereference(siblings, doc, depth, seen);
      return {
        ...(resolved as Record<string, unknown>),
        ...((typeof rest === 'object' && rest !== null ? rest : {}) as Record<string, unknown>),
      };
    }
    return resolved;
  }
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, dereference(v, doc, depth, seen)]));
}

export interface FieldSchema {
  schema: unknown;
}

/**
 * One ECMA-262 pattern matching only where every input pattern matches
 * (lookahead conjunction; anchors inside each branch keep their meaning).
 */
export function conjoinPatterns(patterns: string[]): string {
  return `^${patterns.map((p) => `(?=[\\s\\S]*?(?:${p}))`).join('')}`;
}

/** Merge allOf branches into one object schema (CUE patch bodies compose this way). */
export function flattenComposites(schema: unknown): unknown {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return schema;
  const obj = schema as Record<string, unknown>;
  const allOf = obj['allOf'];
  if (!Array.isArray(allOf)) {
    if (typeof obj['properties'] === 'object' && obj['properties'] !== null) {
      return {
        ...obj,
        properties: Object.fromEntries(
          Object.entries(obj['properties'] as Record<string, unknown>).map(([k, v]) => [
            k,
            flattenComposites(v),
          ]),
        ),
      };
    }
    // Map collections (`{name: item}`) and arrays carry their item schema here;
    // composites inside anyOf/oneOf branches need flattening too.
    const out: Record<string, unknown> = { ...obj };
    if (obj['additionalProperties'] !== undefined) {
      out['additionalProperties'] = flattenComposites(obj['additionalProperties']);
    }
    if (obj['items'] !== undefined) out['items'] = flattenComposites(obj['items']);
    if (Array.isArray(obj['anyOf'])) out['anyOf'] = obj['anyOf'].map(flattenComposites);
    if (Array.isArray(obj['oneOf'])) out['oneOf'] = obj['oneOf'].map(flattenComposites);
    return out;
  }
  const merged: Record<string, unknown> = { type: 'object', properties: {}, required: [] };
  // CUE refines scalars through allOf (`string & format & pattern`): without a
  // scalar preference those branches merge into an empty object that hides the
  // leaf from forms (e.g. system hostname). Object shape always wins when a
  // branch actually carries some; otherwise the scalar (or all-string enum)
  // evidence decides the type.
  let scalarType: string | undefined;
  // allOf is AND: every branch's pattern must hold, so none may be dropped.
  const patterns: string[] = [];
  for (const branch of allOf) {
    const flat = flattenComposites(branch) as Record<string, unknown>;
    if (typeof flat !== 'object' || flat === null || Array.isArray(flat)) continue;
    const t = flat['type'];
    if (
      scalarType === undefined &&
      (t === 'string' || t === 'number' || t === 'integer' || t === 'boolean')
    ) {
      scalarType = t as string;
    }
    if (
      scalarType === undefined &&
      Array.isArray(flat['enum']) &&
      (flat['enum'] as unknown[]).filter((e) => e !== null).every((e) => typeof e === 'string')
    ) {
      scalarType = 'string';
    }
    if (typeof flat['properties'] === 'object' && flat['properties'] !== null) {
      Object.assign(
        merged['properties'] as Record<string, unknown>,
        flat['properties'] as Record<string, unknown>,
      );
    }
    if (Array.isArray(flat['required'])) {
      (merged['required'] as unknown[]).push(...flat['required']);
    }
    if (typeof flat['pattern'] === 'string' && !patterns.includes(flat['pattern']))
      patterns.push(flat['pattern']);
    for (const [k, v] of Object.entries(flat)) {
      if (k !== 'properties' && k !== 'required' && k !== 'allOf' && merged[k] === undefined) merged[k] = v;
    }
  }
  if ((merged['required'] as unknown[]).length === 0) delete merged['required'];
  if (patterns.length > 1) merged['pattern'] = conjoinPatterns(patterns);
  const shapeOf = (n: Record<string, unknown>) =>
    Object.keys((n['properties'] ?? {}) as Record<string, unknown>).length > 0 ||
    n['additionalProperties'] !== undefined ||
    n['items'] !== undefined;
  if (!shapeOf(merged) && !shapeOf(obj) && scalarType !== undefined) {
    merged['type'] = scalarType;
    delete merged['properties'];
  }
  return { ...obj, ...merged, allOf: undefined };
}

/** Request-body schema for a manifest path template + method. Null when none. */
export function requestBodySchema(
  pathTemplate: string,
  method: string,
  doc: Doc = specDoc(),
): FieldSchema | null {
  const op = doc.paths?.[pathTemplate]?.[method.toLowerCase()];
  if (typeof op !== 'object' || op === null) return null;
  const body = (op as { requestBody?: unknown }).requestBody;
  if (typeof body !== 'object' || body === null) return null;
  const resolved = dereference(body, doc) as { content?: Record<string, { schema?: unknown }> };
  const schema = resolved.content?.['application/json']?.schema;
  if (schema === undefined) return null;
  return { schema: flattenComposites(schema) };
}

/** GET 200-response schema for a manifest path template (drives schema columns). Null when none. */
export function responseSchema(pathTemplate: string, doc: Doc = specDoc()): FieldSchema | null {
  const op = doc.paths?.[pathTemplate]?.['get'];
  if (typeof op !== 'object' || op === null) return null;
  const responses = (op as { responses?: unknown }).responses;
  if (typeof responses !== 'object' || responses === null) return null;
  const ok = (responses as Record<string, unknown>)['200'];
  if (typeof ok !== 'object' || ok === null) return null;
  const resolved = dereference(ok, doc) as { content?: Record<string, { schema?: unknown }> };
  const schema = resolved.content?.['application/json']?.schema;
  if (schema === undefined) return null;
  return { schema: flattenComposites(schema) };
}
