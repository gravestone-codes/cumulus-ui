/** NVUE spec manifest builder (roadmap 0.2). Pure: takes the parsed document, returns the summary. */
export interface NvueManifest {
  title: string;
  version: string;
  pathCount: number;
  verbs: Record<string, number>;
  topSegments: Record<string, number>;
  /** resource path → available ?view= values */
  views: Record<string, string[]>;
  /** resource path → allowed methods. Drives the server-side InputGuard (0.7). */
  routes: Record<string, string[]>;
}

interface MinimalOperation {
  parameters?: Array<{ name?: string; schema?: { enum?: unknown } }>;
  responses?: Record<string, unknown>;
}

interface MinimalDoc {
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, MinimalOperation>>;
  [key: string]: unknown;
}

const VERBS = new Set(['get', 'put', 'post', 'patch', 'delete', 'head', 'options']);

/** Resolve a local `#/...` ref inside the document (depth-capped, cycle-safe). */
function resolveRef(doc: MinimalDoc, ref: string, seen: string[] = [], depth = 0): unknown {
  if (!ref.startsWith('#/') || seen.includes(ref) || depth > 10) return undefined;
  let node: unknown = doc;
  for (const seg of ref.slice(2).split('/')) {
    node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[seg] : undefined;
  }
  if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
    const obj = node as Record<string, unknown>;
    if (typeof obj['$ref'] === 'string') return resolveRef(doc, obj['$ref'], [...seen, ref], depth + 1);
  }
  return node;
}

/** `view:*` link names of an operation's 200 response (this spec's ?view= enum). */
function viewLinks(doc: MinimalDoc, op: MinimalOperation): string[] {
  const responses = op.responses;
  if (typeof responses !== 'object' || responses === null) return [];
  let ok = (responses as Record<string, unknown>)['200'];
  if (typeof ok === 'object' && ok !== null && typeof (ok as Record<string, unknown>)['$ref'] === 'string') {
    ok = resolveRef(doc, (ok as Record<string, unknown>)['$ref'] as string);
  }
  const links =
    typeof ok === 'object' && ok !== null ? ((ok as Record<string, unknown>)['links'] as unknown) : undefined;
  if (typeof links !== 'object' || links === null || Array.isArray(links)) return [];
  return Object.keys(links as Record<string, unknown>)
    .filter((k) => k.startsWith('view:'))
    .map((k) => k.slice('view:'.length))
    .sort();
}

/** Build the manifest. Never throws on unknown shapes — counts what it recognizes. */
export function buildManifest(doc: MinimalDoc): NvueManifest {
  const paths = doc.paths ?? {};
  const verbs: Record<string, number> = {};
  const topSegments: Record<string, number> = {};
  const views: Record<string, string[]> = {};
  const routes: Record<string, string[]> = {};
  for (const [path, ops] of Object.entries(paths)) {
    const seg = path === '/' ? 'root' : (path.slice(1).split('/')[0] ?? 'root');
    topSegments[seg] = (topSegments[seg] ?? 0) + 1;
    const methods: string[] = [];
    for (const [method, op] of Object.entries(ops ?? {})) {
      if (!VERBS.has(method)) continue;
      verbs[method] = (verbs[method] ?? 0) + 1;
      methods.push(method);
      const params = op.parameters ?? [];
      const view = params.find((p) => p?.name === 'view');
      const values = new Set(
        Array.isArray(view?.schema?.enum)
          ? view.schema.enum.filter((v): v is string => typeof v === 'string')
          : [],
      );
      // This spec carries views as response links, not a query-param enum.
      for (const v of viewLinks(doc, op)) values.add(v);
      if (values.size > 0) views[path] = [...values].sort();
    }
    if (methods.length > 0) routes[path] = methods.sort();
  }
  return {
    title: doc.info?.title ?? 'unknown',
    version: doc.info?.version ?? 'unknown',
    pathCount: Object.keys(paths).length,
    verbs,
    topSegments,
    views,
    routes,
  };
}
