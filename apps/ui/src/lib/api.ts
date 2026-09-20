import type { CsvRow } from './csv.js';

/**
 * Backend client. Same-origin cookies carry the session (decision 11);
 * every runtime datum comes from here — never hardcoded (decision 10).
 * Errors are RFC 9457 problem details.
 */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  constructor(problem: Problem, fallback: string) {
    super(problem.detail ?? problem.title ?? fallback);
    this.status = problem.status;
    this.title = problem.title;
  }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    credentials: 'include',
    ...rest,
    headers: {
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      ...rest.headers,
    },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text().catch(() => '');
  let body: Problem | null = null;
  try {
    body = text ? (JSON.parse(text) as Problem) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const detail = body?.detail ?? body?.title ?? `HTTP ${res.status}: ${text.slice(0, 200)}`;
    throw new ApiError(
      { type: 'about:blank', title: body?.title ?? 'Error', status: res.status, detail },
      `request failed: ${path}`,
    );
  }
  return body as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', json: body === undefined ? undefined : body });
const put = <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', json: body });

export interface SetupStatus {
  initialized: boolean;
}
export interface PlatformUser {
  id: string;
  display_name: string;
}
export interface SwitchRow {
  id: string;
  display_name: string;
  base_url: string;
  base_path: string;
  cert_fingerprint: string | null;
  enabled: boolean;
  groups: string[];
  trust_verified?: boolean;
  last_seen_at?: string | null;
  last_check_at?: string | null;
  last_check_ok?: boolean | null;
}
export interface GroupRow {
  id: string;
  display_name: string;
}
export interface ImportResult {
  results: Array<{ id: string; ok: boolean; fingerprint?: string; trust_verified?: boolean; error?: string }>;
}
export interface AuditRow {
  id: number;
  ts: string;
  user_sub: string;
  username: string;
  roles: string[];
  switch_id: string | null;
  method: string;
  path: string;
  rev: string | null;
  job_id: string | null;
}
export interface PlatformUserRow {
  id: string;
  display_name: string;
  disabled: boolean;
  roles: string[];
}
export interface RoleRow {
  id: string;
  display_name: string;
}
export interface QueryResult<T = unknown> {
  data: T;
  cached: boolean;
  rev?: string;
  checked_at: string;
}
export interface SpecManifest {
  version: string;
  routes: Record<string, string[]>;
  views: Record<string, string[]>;
}
export interface FieldSchema {
  schema: unknown;
}

export const api = {
  setupStatus: () => request<SetupStatus>('/api/v1/setup/status'),
  setupAdmin: (body: { id: string; display_name: string; password: string }) =>
    post<{ user: PlatformUser }>('/api/v1/setup/admin', body),
  login: (body: { username: string; password: string }) =>
    post<{ user: PlatformUser }>('/api/v1/auth/login', body),
  logout: () => post<{ ok: true }>('/api/v1/auth/logout'),
  me: () => request<{ user: PlatformUser & { username: string }; roles: string[] }>('/api/v1/auth/me'),
  devReset: () => post<{ ok: boolean; reset: boolean }>('/api/v1/dev/reset'),

  switches: () => request<SwitchRow[]>('/api/v1/inventory/switches'),
  createSwitch: (body: { id: string; display_name: string; base_url: string }) =>
    post<SwitchRow>('/api/v1/inventory/switches', body),
  setSwitchGroups: (id: string, groups: string[]) =>
    request<{ ok: true }>(`/api/v1/inventory/switches/${encodeURIComponent(id)}/groups`, {
      method: 'PUT',
      json: { groups },
    }),
  trustSwitch: (id: string, fingerprint: string) =>
    post<{ ok: boolean; trust_verified: boolean }>(
      `/api/v1/inventory/switches/${encodeURIComponent(id)}/trust`,
      {
        fingerprint,
      },
    ),
  groups: () => request<GroupRow[]>('/api/v1/inventory/groups'),
  createGroup: (body: { id: string; display_name: string }) =>
    post<GroupRow>('/api/v1/inventory/groups', body),

  setMyCredential: (switchId: string, body: { switch_username: string; switch_password: string }) =>
    put<{ ok: true }>(`/api/v1/me/switch-credentials/${encodeURIComponent(switchId)}`, body),
  connectSwitch: (id: string) => post<void>(`/api/v1/switch-auth/${encodeURIComponent(id)}`, {}),
  verifySwitch: (id: string) =>
    post<{ ok: boolean; switch: string; data: unknown }>(`/api/v1/switches/${encodeURIComponent(id)}/verify`),
  importSwitches: (rows: CsvRow[]) => post<ImportResult>('/api/v1/inventory/import', { rows }),
  audit: (limit = 8) => request<AuditRow[]>(`/api/v1/audit?limit=${limit}`),
  platformUsers: () => request<PlatformUserRow[]>('/api/v1/users'),
  platformRoles: () => request<RoleRow[]>('/api/v1/roles'),

  query: <T = unknown>(switchId: string, path: string, opts?: { rev?: string; view?: string }) => {
    const qs = new URLSearchParams({ path });
    if (opts?.rev) qs.set('rev', opts.rev);
    if (opts?.view) qs.set('view', opts.view);
    return request<QueryResult<T>>(`/api/v1/switches/${encodeURIComponent(switchId)}/query?${qs}`);
  },
  manifest: () => request<SpecManifest>('/api/v1/spec/manifest'),
  fields: (path: string, method: string) => {
    const qs = new URLSearchParams({ path, method });
    return request<FieldSchema>(`/api/v1/spec/fields?${qs}`);
  },
};
