/**
 * Config renderings of an NVUE revision tree (`GET /?rev=applied`): the
 * `nv config show -o commands` line form and the `nv config show` YAML form,
 * plus a line diff between two revisions. Pure code over backend data — the
 * CLI's own range folding (swp1-4) is not reproduced; every line stays exact.
 */

type Tree = Record<string, unknown>;

const isObj = (v: unknown): v is Tree => typeof v === 'object' && v !== null && !Array.isArray(v);

/** CLI token: bare when safe, single-quoted (with ' escaped) otherwise. */
export function cliToken(v: unknown): string {
  const s = String(v);
  if (s !== '' && /^[\w.:/@,+*=-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** `nv set …` lines: a leaf per value, a bare path per empty object (set members, tags). The revision header is not config. */
export function toCommands(tree: unknown, prefix: string[] = []): string[] {
  if (!isObj(tree)) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(prefix.length === 0 ? splitHeader(tree).set : tree)) {
    const path = [...prefix, cliToken(key)];
    if (isObj(value)) {
      if (Object.keys(value).length === 0) out.push(`nv set ${path.join(' ')}`);
      else out.push(...toCommands(value, path));
    } else if (Array.isArray(value)) {
      for (const item of value) out.push(`nv set ${path.join(' ')} ${cliToken(item)}`);
    } else if (value !== null && value !== undefined) {
      out.push(`nv set ${path.join(' ')} ${cliToken(value)}`);
    }
  }
  return out;
}

const YAML_PLAIN = /^[A-Za-z0-9_./][\w./:@+-]*$/;
const YAML_RESERVED = /^(true|false|yes|no|null|~)$/i;

function yamlScalar(v: unknown): string {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null || v === undefined) return 'null';
  const s = String(v);
  // Strings that would read back as numbers or keywords keep quotes, as the CLI prints them.
  if (YAML_PLAIN.test(s) && !YAML_RESERVED.test(s) && Number.isNaN(Number(s))) return s;
  return `'${s.replace(/'/g, "''")}'`;
}

function yamlKey(k: string): string {
  return YAML_PLAIN.test(k) && !YAML_RESERVED.test(k) ? k : `'${k.replace(/'/g, "''")}'`;
}

/** Block YAML for a JSON tree (maps, sequences, scalars), two-space indents. */
export function toYaml(value: unknown, indent = 0): string[] {
  const pad = ' '.repeat(indent);
  if (isObj(value)) {
    return Object.entries(value).flatMap(([k, v]) => {
      if (isObj(v) && Object.keys(v).length > 0) return [`${pad}${yamlKey(k)}:`, ...toYaml(v, indent + 2)];
      if (isObj(v)) return [`${pad}${yamlKey(k)}: {}`];
      if (Array.isArray(v)) {
        return v.length === 0
          ? [`${pad}${yamlKey(k)}: []`]
          : [`${pad}${yamlKey(k)}:`, ...toYaml(v, indent + 2)];
      }
      return [`${pad}${yamlKey(k)}: ${yamlScalar(v)}`];
    });
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (isObj(item) || Array.isArray(item)) {
        const [first = '', ...rest] = toYaml(item, indent + 2);
        return [`${pad}- ${first.trimStart()}`, ...rest];
      }
      return [`${pad}- ${yamlScalar(item)}`];
    });
  }
  return [`${pad}${yamlScalar(value)}`];
}

/** A revision read with `filled=false` carries `header` (model, release, rev-id) beside the config. */
export function splitHeader(tree: unknown): { header?: Tree; set: Tree } {
  if (!isObj(tree)) return { set: {} };
  const { header, ...set } = tree;
  return isObj(header) ? { header, set } : { set: tree };
}

/** `nv config show` shape: an optional `- header:` document, then `- set:` with the config. */
export function configYaml(tree: unknown): string[] {
  const { header, set } = splitHeader(tree);
  return [...(header ? ['- header:', ...toYaml(header, 4)] : []), '- set:', ...toYaml(set, 4)];
}

export interface DiffLine {
  op: '+' | '-';
  line: string;
}

/** Command lines only in `next` (+) or only in `base` (−), in their own order. */
export function diffCommands(base: string[], next: string[]): DiffLine[] {
  const a = new Set(base);
  const b = new Set(next);
  return [
    ...base.filter((l) => !b.has(l)).map((line) => ({ op: '-' as const, line })),
    ...next.filter((l) => !a.has(l)).map((line) => ({ op: '+' as const, line })),
  ];
}
