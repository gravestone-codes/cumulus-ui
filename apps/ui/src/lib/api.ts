import type { CsvRow } from './csv.js';
import type { TrafficSample } from './traffic.js';

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
  /** Extra error payload fields (e.g. `conflicts` on a 409 apply). */
  readonly data: Record<string, unknown>;
  constructor(problem: Problem & Record<string, unknown>, fallback: string) {
    super(problem.detail ?? problem.title ?? fallback);
    this.status = problem.status;
    this.title = problem.title;
    const data: Record<string, unknown> = { ...problem };
    delete data.type;
    delete data.title;
    delete data.status;
    delete data.detail;
    this.data = data;
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
      {
        ...(body ?? {}),
        type: 'about:blank',
        title: body?.title ?? 'Error',
        status: res.status,
        detail,
      },
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
/** One member's answer in a group fan-out (read, stage, apply or action). */
export interface MemberResult<T = unknown> {
  switchId: string;
  ok: boolean;
  data?: T;
  status?: number;
  error?: string;
  branch?: string;
  jobId?: string | null;
  finalState?: string | null;
  /** Unapplied changes already staged there; discard before staging this change. */
  conflict?: boolean;
  /** Apply-time overlap details for the conflict screen (mine/landed/base). */
  conflicts?: ApplyConflict[];
  /** The switch changed outside the app since you last refreshed it — refresh before editing. */
  drift?: boolean;
  /** Your draft predates a change made outside the app; the whole draft is under review. */
  outOfBand?: Drift;
}
/** A switch's applied revision moved outside the app (CLI or direct API). */
export interface Drift {
  switchId: string;
  from: string;
  to: string;
  /** Switch-side attribution of the move, when NVUE reports it. */
  by: { user: string | null; type: string | null; date: string | null } | null;
  detectedAt: string;
  /** Present on the banner feed: the switch's groups, for scope filtering. */
  groups?: string[];
}
/** One apply-time overlap: my staged value vs what landed vs my base. */
export interface ApplyConflict {
  path: string;
  method: string;
  before?: unknown;
  mine?: unknown;
  current?: unknown;
  /** Who applied the landed value, when known (null = changed outside the app). */
  landedBy?: { userSub: string; username: string } | null;
}
/** Another user on a switch: an open editor and/or unapplied staged work. */
export interface PresenceEntry {
  userSub: string;
  username: string;
  open: boolean;
  staged: number;
  updatedAt: string | null;
}
/** One staged path as a dry-run row (before → intent). */
export interface StagedDiff {
  path: string;
  method: string;
  before?: unknown;
  mine?: unknown;
}
/** Outcome of re-staging a stale draft on a fresh branch off applied. */
export interface RebaseResult {
  rebased: boolean;
  /** Nothing left to stage: someone else already applied the same values. */
  alreadyApplied: boolean;
  branch: string | null;
  baseRev: string | null;
  staged: string[];
  dropped: string[];
}
export type StageCall = { path: string; method: 'PATCH' | 'DELETE'; body?: Record<string, unknown> };

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
  deleteSwitch: (id: string) =>
    request<{ ok: true }>(`/api/v1/inventory/switches/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  renameSwitch: (id: string, display_name: string) =>
    request<{ ok: true }>(`/api/v1/inventory/switches/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: { display_name },
    }),
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
  deleteGroup: (id: string) =>
    request<{ ok: true }>(`/api/v1/inventory/groups/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  renameGroup: (id: string, display_name: string) =>
    request<{ ok: true }>(`/api/v1/inventory/groups/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      json: { display_name },
    }),

  setMyCredential: (switchId: string, body: { switch_username: string; switch_password: string }) =>
    put<{ ok: true }>(`/api/v1/me/switch-credentials/${encodeURIComponent(switchId)}`, body),
  connectSwitch: (id: string) => post<void>(`/api/v1/switch-auth/${encodeURIComponent(id)}`, {}),
  verifySwitch: (id: string) =>
    post<{ ok: boolean; switch: string; data: unknown }>(`/api/v1/switches/${encodeURIComponent(id)}/verify`),
  importSwitches: (rows: CsvRow[]) => post<ImportResult>('/api/v1/inventory/import', { rows }),

  openBranch: (switchId: string) =>
    post<{ branch: string; baseRev: string }>(`/api/v1/switches/${encodeURIComponent(switchId)}/branch`, {}),
  discardBranch: (switchId: string) =>
    request<{ switchDiscarded: boolean }>(`/api/v1/switches/${encodeURIComponent(switchId)}/branch`, {
      method: 'DELETE',
    }),
  stageChange: (
    switchId: string,
    body: { path: string; method: 'PATCH' | 'DELETE'; body?: Record<string, unknown> },
  ) => post<{ ok: true; branch: string }>(`/api/v1/switches/${encodeURIComponent(switchId)}/stage`, body),
  getDiff: (switchId: string) =>
    request<{
      branch: string;
      baseRev: string;
      diffs: Array<{
        path: string;
        method: string;
        state?: string;
        before?: unknown;
        mine?: unknown;
        current?: unknown;
      }>;
    }>(`/api/v1/switches/${encodeURIComponent(switchId)}/diff`),
  drifts: () => request<Drift[]>('/api/v1/drift'),
  ackDrift: (switchId: string) =>
    post<{ ok: true }>(`/api/v1/switches/${encodeURIComponent(switchId)}/drift/ack`, {}),
  heartbeat: (switchId: string, path: string) =>
    post<{ ok: true }>(`/api/v1/switches/${encodeURIComponent(switchId)}/presence`, { path }),
  presence: (switchId: string, path: string) =>
    request<PresenceEntry[]>(
      `/api/v1/switches/${encodeURIComponent(switchId)}/presence?${new URLSearchParams({ path })}`,
    ),
  theirStaged: (switchId: string, userSub: string, path: string) =>
    request<{ branch: string; baseRev: string | null; diffs: StagedDiff[] }>(
      `/api/v1/switches/${encodeURIComponent(switchId)}/presence/${encodeURIComponent(userSub)}/staged?${new URLSearchParams({ path })}`,
    ),
  applyBranch: (switchId: string) =>
    post<{ applied: boolean; jobId: string | null; paths: string[] }>(
      `/api/v1/switches/${encodeURIComponent(switchId)}/apply`,
      {},
    ),
  rebaseBranch: (switchId: string) =>
    post<RebaseResult>(`/api/v1/switches/${encodeURIComponent(switchId)}/rebase`, {}),
  groupRebase: (groupId: string, members?: string[]) =>
    post<{ results: Array<MemberResult & Partial<RebaseResult>> }>(
      `/api/v1/groups/${encodeURIComponent(groupId)}/rebase`,
      members ? { members } : {},
    ),
  getJob: (switchId: string, jobId: string) =>
    request<{ id: string; state: string }>(
      `/api/v1/switches/${encodeURIComponent(switchId)}/jobs/${encodeURIComponent(jobId)}`,
    ),
  ifaceSamples: (switchId: string, iface: string, minutes = 15) =>
    request<{ samples: TrafficSample[]; earliest: string | null }>(
      `/api/v1/switches/${encodeURIComponent(switchId)}/interfaces/${encodeURIComponent(iface)}/samples?minutes=${minutes}`,
    ),
  history: (
    switchId: string,
    iface: string,
    opts: { range?: string; metric?: string; from?: string; to?: string } = {},
  ) => {
    const qs = new URLSearchParams();
    if (opts.range) qs.set('range', opts.range);
    if (opts.metric) qs.set('metric', opts.metric);
    if (opts.from) qs.set('from', opts.from);
    if (opts.to) qs.set('to', opts.to);
    return request<{
      range: string;
      metric: string;
      points: Array<{ t: string; in: number; out: number }>;
      earliest: string | null;
    }>(
      `/api/v1/switches/${encodeURIComponent(switchId)}/interfaces/${encodeURIComponent(iface)}/history?${qs}`,
    );
  },
  ifaceCoverage: (switchId: string, iface: string) =>
    request<{ spans: Array<{ from: string; to: string }> }>(
      `/api/v1/switches/${encodeURIComponent(switchId)}/interfaces/${encodeURIComponent(iface)}/coverage`,
    ),
  switchTraffic: (switchId: string, opts: { range?: string; metric?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.range) qs.set('range', opts.range);
    if (opts.metric) qs.set('metric', opts.metric);
    return request<{ range: string; metric: string; points: Array<{ t: string; in: number; out: number }> }>(
      `/api/v1/switches/${encodeURIComponent(switchId)}/traffic?${qs}`,
    );
  },
  audit: (limit = 8, sw?: string) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (sw) qs.set('switch', sw);
    return request<AuditRow[]>(`/api/v1/audit?${qs}`);
  },
  platformUsers: () => request<PlatformUserRow[]>('/api/v1/users'),
  platformRoles: () => request<RoleRow[]>('/api/v1/roles'),
  dashboard: () =>
    request<{ widgets: Array<{ id: string; config?: Record<string, unknown> }> }>('/api/v1/me/dashboard'),
  saveDashboard: (widgets: Array<{ id: string; config?: Record<string, unknown> }>) =>
    request<{ widgets: Array<{ id: string }> }>('/api/v1/me/dashboard', { method: 'PUT', json: { widgets } }),

  query: <T = unknown>(switchId: string, path: string, opts?: { rev?: string; view?: string }) => {
    const qs = new URLSearchParams({ path });
    if (opts?.rev) qs.set('rev', opts.rev);
    if (opts?.view) qs.set('view', opts.view);
    return request<QueryResult<T>>(`/api/v1/switches/${encodeURIComponent(switchId)}/query?${qs}`);
  },
  groupQuery: <T = unknown>(groupId: string, path: string, opts?: { rev?: string; view?: string }) => {
    const qs = new URLSearchParams({ path });
    if (opts?.rev) qs.set('rev', opts.rev);
    if (opts?.view) qs.set('view', opts.view);
    return request<{ results: MemberResult<T>[] }>(
      `/api/v1/groups/${encodeURIComponent(groupId)}/query?${qs}`,
    );
  },
  groupStage: (
    groupId: string,
    body: {
      path: string;
      method: 'PATCH' | 'DELETE';
      body?: Record<string, unknown>;
      bodies?: Record<string, Record<string, unknown>>;
      members?: string[];
      exclusive?: boolean;
    },
  ) => post<{ results: MemberResult[] }>(`/api/v1/groups/${encodeURIComponent(groupId)}/stage`, body),
  groupApply: (groupId: string, members: string[]) =>
    post<{ results: MemberResult[] }>(`/api/v1/groups/${encodeURIComponent(groupId)}/apply`, { members }),
  groupAction: (groupId: string, body: { path: string; body?: Record<string, unknown>; members: string[] }) =>
    post<{ results: MemberResult[] }>(`/api/v1/groups/${encodeURIComponent(groupId)}/action`, body),
  runAction: (switchId: string, body: { path: string; body?: Record<string, unknown> }) =>
    post<{ jobId: string | null; finalState: string | null }>(
      `/api/v1/switches/${encodeURIComponent(switchId)}/action`,
      body,
    ),
  manifest: () => request<SpecManifest>('/api/v1/spec/manifest'),
  fields: (path: string, method: string) => {
    const qs = new URLSearchParams({ path, method });
    return request<FieldSchema>(`/api/v1/spec/fields?${qs}`);
  },
};
