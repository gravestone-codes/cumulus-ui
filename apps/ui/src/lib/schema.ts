/**
 * Schema-driven list columns (roadmap 2.1/R7): collection response schemas
 * (`GET /api/v1/spec/fields?method=GET`) enumerate the pickable fields; the
 * checked set becomes both the rendered columns and the `?include` patterns.
 * Labels come from the schema (`title`/`description`) with a prettified key
 * fallback — never hand-mapped per domain.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from './api.js';
import { choicesOf, invalidReason, kindOf, leafSchema } from './fieldSchema.js';
import type { FormField } from './plan.js';

type Schema = Record<string, unknown>;

/** One scalar leaf addressable as a column: slash path, label, scalar kind. */
export interface SchemaLeaf {
  path: string;
  label: string;
  kind: string;
}

/** Unwrap a collection response schema to its item schema (map or array values). */
export function itemSchema(schema: unknown): Schema | null {
  const obj = schema as Schema | null;
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
  // Map/array members first: a bare `properties` branch may be an action body, not the item.
  const members = (node: unknown): Schema | null => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return null;
    const n = node as Schema;
    if (typeof n['additionalProperties'] === 'object' && n['additionalProperties'] !== null) {
      return n['additionalProperties'] as Schema;
    }
    if (typeof n['items'] === 'object' && n['items'] !== null && !Array.isArray(n['items'])) {
      return n['items'] as Schema;
    }
    return null;
  };
  const asItem = (node: unknown): Schema | null => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return null;
    const n = node as Schema;
    if (typeof n['properties'] === 'object' && n['properties'] !== null) return n;
    return null;
  };
  const branches: unknown[] = [
    ...(Array.isArray(obj['anyOf']) ? obj['anyOf'] : []),
    ...(Array.isArray(obj['oneOf']) ? obj['oneOf'] : []),
  ];
  for (const b of branches) {
    const found = members(b);
    if (found) return found;
  }
  const direct = members(obj);
  if (direct) return direct;
  for (const b of branches) {
    const found = asItem(b);
    if (found) return found;
  }
  return asItem(obj);
}

const SCALAR = new Set(['string', 'number', 'integer', 'boolean']);
/** Last segment as a label (`link/admin-status` → `Admin status`). */
export function leafLabel(path: string, schema?: Schema): string {
  const titled = typeof schema?.['title'] === 'string' && schema['title'];
  if (titled) return titled;
  const last = path.split('/').pop() ?? path;
  const words = last.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Kind of an anyOf/oneOf whose branches are all scalars (first non-enum type wins), else null. */
function scalarUnion(sub: Schema): string | null {
  const branches = [
    ...(Array.isArray(sub['anyOf']) ? sub['anyOf'] : []),
    ...(Array.isArray(sub['oneOf']) ? sub['oneOf'] : []),
  ];
  if (branches.length === 0) return null;
  let kind: string | null = null;
  for (const b of branches) {
    if (typeof b !== 'object' || b === null || Array.isArray(b)) return null;
    const branch = b as Schema;
    if ('properties' in branch || 'additionalProperties' in branch || 'items' in branch) return null;
    const t = branch['type'];
    const isEnum = Array.isArray(branch['enum']);
    if (!isEnum && !(typeof t === 'string' && SCALAR.has(t))) return null;
    if (!isEnum && kind === null) kind = t as string;
  }
  return kind ?? 'enum';
}

/** Scalar leaves of an item schema, depth-capped (counters stay reachable, trees do not). */
export function scalarLeaves(item: Schema, prefix = '', depth = 0, maxDepth = 3): SchemaLeaf[] {
  if (depth >= maxDepth) return [];
  const props = item['properties'];
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return [];
  const out: SchemaLeaf[] = [];
  for (const [key, raw] of Object.entries(props as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const sub = raw as Schema;
    const path = prefix ? `${prefix}/${key}` : key;
    // Nullable on/off leaves arrive as `type: object` + `enum: [on, off, null]`.
    const values = Array.isArray(sub['enum']) ? sub['enum'].filter((e) => e !== null) : [];
    if (values.length > 0 && values.every((e) => typeof e === 'string')) {
      out.push({ path, label: leafLabel(path, sub), kind: 'enum' });
      continue;
    }
    const type = sub['type'];
    if (typeof type === 'string' && SCALAR.has(type)) {
      out.push({ path, label: leafLabel(path, sub), kind: type });
      continue;
    }
    // Value-or-keyword leaves (`table`: integer | "auto", AS: integer | "none").
    const union = scalarUnion(sub);
    if (union) {
      out.push({ path, label: leafLabel(path, sub), kind: union });
      continue;
    }
    if (type === 'object' || typeof sub['properties'] === 'object') {
      out.push(...scalarLeaves(sub, path, depth + 1, maxDepth));
    }
  }
  return out;
}

// Leaf paths to NVUE `?include` patterns. Collections address members with
// a star-slash wildcard prefix; item reads take root-relative pointers.
export function toIncludePatterns(readPath: string, leaves: string[]): string[] {
  const collection = !readPath.includes('{');
  return [...new Set(leaves)].map((leaf) => (collection ? `/*/${leaf}` : `/${leaf}`));
}

/**
 * NVUE feature toggles gate their siblings: `vxlan/enable` governs
 * `vxlan/port`, a root `enable` governs every other leaf. Returns each
 * path's governing enable leaves (outermost first); ungated paths are absent.
 */
export function enableGates(paths: string[]): Map<string, string[]> {
  const toggles = paths.filter((p) => p === 'enable' || p.endsWith('/enable'));
  const gates = new Map<string, string[]>();
  for (const path of paths) {
    const by = toggles
      .filter((t) => t !== path && path.startsWith(t.slice(0, -'enable'.length)))
      .sort((a, b) => a.length - b.length);
    if (by.length > 0) gates.set(path, by);
  }
  return gates;
}

/** Scalar leaves for a template, live from the backend (dumb UI). */
export function useSchemaLeaves(
  pathTemplate?: string,
  method = 'PATCH',
): {
  leaves: SchemaLeaf[];
  loading: boolean;
} {
  const q = useQuery({
    queryKey: ['schema-leaves', pathTemplate ?? '', method],
    queryFn: async () => {
      const { schema } = await api.fields(pathTemplate ?? '', method);
      const item = itemSchema(schema);
      return item ? scalarLeaves(item) : [];
    },
    staleTime: 300_000,
    enabled: !!pathTemplate,
  });
  return { leaves: q.data ?? [], loading: q.isPending && !!pathTemplate };
}

/**
 * A container's sections (`/router` → bgp, ospf, pim…): its object-typed
 * properties, minus `@action` operations and on/off enums, in schema order,
 * plus every scalar leaf (top-level ones are the container's own settings).
 */
export function sectionsOf(item: Schema): { sections: string[]; leaves: SchemaLeaf[] } {
  const props = item['properties'];
  const sections =
    typeof props === 'object' && props !== null
      ? Object.entries(props as Record<string, unknown>)
          .filter(([key, raw]) => {
            if (key.startsWith('@') || typeof raw !== 'object' || raw === null) return false;
            const sub = raw as Schema;
            if (Array.isArray(sub['enum'])) return false;
            return sub['type'] === 'object' || 'properties' in sub || 'additionalProperties' in sub;
          })
          .map(([key]) => key)
      : [];
  return { sections, leaves: scalarLeaves(item) };
}

/** Sections + leaves of a container template, live from the backend (dumb UI). */
export function useSchemaSections(pathTemplate: string): {
  sections: string[];
  leaves: SchemaLeaf[];
  loading: boolean;
} {
  const q = useQuery({
    queryKey: ['schema-sections', pathTemplate],
    queryFn: async () => {
      const { schema } = await api.fields(pathTemplate, 'PATCH');
      const item = itemSchema(schema);
      return item ? sectionsOf(item) : { sections: [], leaves: [] };
    },
    staleTime: 300_000,
  });
  return { sections: q.data?.sections ?? [], leaves: q.data?.leaves ?? [], loading: q.isPending };
}

/** Checked-field state for the picker: persisted per table, reconciled to the schema. */
export function useSchemaFields(
  storageKey: string,
  leaves: SchemaLeaf[],
  defaults: string[],
): { checked: string[]; setChecked: (paths: string[]) => void } {
  const [stored, setStored] = useState<string[] | null>(() => {
    try {
      const raw = window.localStorage.getItem(`${storageKey}.fields`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : null;
    } catch {
      return null;
    }
  });
  const known = new Set(leaves.map((l) => l.path));
  const checked = (stored ?? defaults).filter((p) => known.has(p));
  function setChecked(paths: string[]) {
    // The picker never empties the table: dropping the last field keeps the previous set.
    if (paths.length === 0) return;
    setStored(paths);
    try {
      window.localStorage.setItem(`${storageKey}.fields`, JSON.stringify(paths));
    } catch {
      /* private mode: picker lasts the session */
    }
  }
  return { checked, setChecked };
}

/**
 * PATCH-body leaves as planned form fields (roadmap 2.3/R9): kinds, choices
 * and validation from the schema, labels overridden for presentation.
 * `only` carves a thin slice (e.g. one field); unknown leaves are dropped.
 */
export function planFieldsFromSchema(
  schema: unknown,
  opts: { only?: string[]; labels?: Record<string, string> } = {},
): FormField[] {
  const out: FormField[] = [];
  const items = opts.only ?? scalarLeaves((itemSchema(schema) ?? schema) as Schema).map((l) => l.path);
  for (const leaf of items) {
    const s = leafSchema(schema, leaf);
    if (s === undefined && opts.only === undefined) continue;
    const kind = kindOf(s);
    out.push({
      path: leaf,
      label: opts.labels?.[leaf] ?? leafLabel(leaf, s),
      kind,
      choices: choicesOf(s),
      perSwitch: false,
      invalid: (t: string) => invalidReason(kind, t, s),
      schema: s,
    });
  }
  return out;
}
