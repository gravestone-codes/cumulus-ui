/**
 * NVUE revision/apply/job protocol, isolated in one module (roadmap Phase 1).
 * Shapes follow openapi.json operationIds (createRevision/getRevisions,
 * actionConfig/getActions) plus the documented changeset-PATCH apply flow.
 * NVUE's exact response envelopes are hardware-validated at M1 — if the lab
 * switch disagrees, adjust the parse* functions below, nowhere else.
 */
import { NvueClient } from './client.js';

export interface BranchInfo {
  /** Opaque revision/branch id used as ?rev= on subsequent calls. */
  branch: string;
  /** Applied marker the branch was based on (best-effort, may be null). */
  baseRev: string | null;
}

/** Extract a branch id from a createRevision response. Tries known shapes, then common id fields. */
export function parseBranchId(body: unknown): string | null {
  if (typeof body === 'string' && body.length > 0) return body;
  if (typeof body !== 'object' || body === null) return null;
  const o = body as Record<string, unknown>;
  for (const key of ['rev', 'revision', 'changeset', 'id', 'branch']) {
    const v = o[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  for (const v of Object.values(o)) {
    if (typeof v === 'object' && v !== null) {
      const nested = parseBranchId(v);
      if (nested) return nested;
    }
  }
  return null;
}

/** Create a pending branch off the applied state. */
export async function createBranch(client: NvueClient, token: string): Promise<BranchInfo> {
  const { data } = await client.call({
    path: '/revision',
    method: 'POST',
    token,
    params: { base_rev: 'applied' },
  });
  const branch = parseBranchId(data);
  if (!branch) throw new Error('switch did not return a branch id from POST /revision');
  return { branch, baseRev: 'applied' };
}

export interface RevisionEntry {
  id: string;
  raw: unknown;
}

/** Best-effort revision listing (GET /revision). Shape varies — entries carry raw payloads. */
export async function listRevisions(client: NvueClient, token: string): Promise<RevisionEntry[]> {
  const { data } = await client.call({ path: '/revision', method: 'GET', token });
  const items = Array.isArray(data) ? data : ((data as { revisions?: unknown[] })?.revisions ?? []);
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const id = parseBranchId(item);
    return id ? [{ id, raw: item }] : [];
  });
}

/** Apply a branch: PATCH its changeset with {state: apply} (documented flow). Returns a job id. */
export async function applyBranch(
  client: NvueClient,
  token: string,
  branch: string,
): Promise<{ jobId: string | null }> {
  const { data } = await client.call({
    path: `/revision/${encodeURIComponent(branch)}`,
    method: 'PATCH',
    token,
    body: { state: 'apply', 'auto-prompt': { ays: 'ays_yes' } },
  });
  return {
    jobId: extractJobId(data),
  };
}

/** Extract a job id from an apply/action response. `job` first, then id-like fields. */
export function extractJobId(data: unknown): string | null {
  if (typeof data === 'object' && data !== null && typeof (data as { job?: unknown }).job === 'string') {
    return (data as { job: string }).job;
  }
  return parseBranchId(data);
}

export interface ActionJob {
  id: string;
  state: string;
  raw: unknown;
}

/** Fetch one action job (GET /action). State strings compared loosely by callers. */
export async function getAction(client: NvueClient, token: string, jobId: string): Promise<ActionJob> {
  const { data } = await client.call({ path: `/action/${encodeURIComponent(jobId)}`, method: 'GET', token });
  const o = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  return {
    id: typeof o.id === 'string' ? o.id : jobId,
    state: typeof o.state === 'string' ? o.state : 'unknown',
    raw: data,
  };
}
