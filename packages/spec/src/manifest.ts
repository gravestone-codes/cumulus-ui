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
}

interface MinimalDoc {
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, MinimalOperation>>;
}

const VERBS = new Set(['get', 'put', 'post', 'patch', 'delete', 'head', 'options']);

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
      const values = Array.isArray(view?.schema?.enum)
        ? view.schema.enum.filter((v): v is string => typeof v === 'string')
        : [];
      if (values.length > 0) views[path] = values;
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
