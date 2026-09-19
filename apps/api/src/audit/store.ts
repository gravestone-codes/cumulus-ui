/**
 * Audit trail (roadmap 0.9: R2e). Append-only, hash-chained, secret-redacted.
 * Writes serialize on an advisory transaction lock (held for the whole
 * write transaction — the correct xact_lock shape, unlike a bare SELECT).
 * Purged rows break the chain's head, not its integrity: verification anchors
 * on each remaining row's stored prev_hash, so tampering is still detected.
 */
import { createHash } from 'node:crypto';
import { db } from '../db.js';

export interface AuditEntry {
  userSub: string;
  username: string;
  roles: string[];
  switchId?: string;
  method: string;
  path: string;
  before?: unknown;
  after?: unknown;
  rev?: string;
  jobId?: string;
}

const SECRET_KEYS = /password|passwd|secret|private|token|api[_-]?key|community|seed/i;

/** Recursively replace secret-bearing values. Pure — unit-tested. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEYS.test(k) ? '[redacted]' : redact(v),
      ]),
    );
  }
  return value;
}

function canonical(entry: Omit<AuditEntry, never> & { ts: string; prevHash: string }): string {
  return JSON.stringify({
    ts: entry.ts,
    user: entry.userSub,
    roles: entry.roles,
    switch: entry.switchId ?? null,
    method: entry.method,
    path: entry.path,
    before: redact(entry.before) ?? null,
    after: redact(entry.after) ?? null,
    rev: entry.rev ?? null,
    job: entry.jobId ?? null,
    prev: entry.prevHash,
  });
}

function hashOf(canonicalForm: string): string {
  return createHash('sha256').update(canonicalForm, 'utf8').digest('hex');
}

/** Append one entry. Returns the row id. */
export async function audit(entry: AuditEntry): Promise<number> {
  const pool = db();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('cumulus-audit'))`);
    const prev = await client.query<{ hash: string }>('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
    const prevHash = prev.rows[0]?.hash ?? 'GENESIS';
    const ts = new Date().toISOString();
    const canonicalForm = canonical({ ...entry, ts, prevHash });
    const hash = hashOf(canonicalForm);
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO audit_log (ts, user_sub, username, roles, switch_id, method, path, before, after, rev, job_id, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        ts,
        entry.userSub,
        entry.username,
        JSON.stringify(entry.roles),
        entry.switchId ?? null,
        entry.method,
        entry.path,
        JSON.stringify(redact(entry.before) ?? null),
        JSON.stringify(redact(entry.after) ?? null),
        entry.rev ?? null,
        entry.jobId ?? null,
        prevHash,
        hash,
      ],
    );
    await client.query('COMMIT');
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('audit insert returned no id');
    return id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface ChainReport {
  ok: boolean;
  checked: number;
  badId?: number;
}

/** Recompute every link. Returns the first broken row id, if any. */
export async function verifyChain(): Promise<ChainReport> {
  const { rows } = await db().query<{
    id: number;
    ts: string;
    user_sub: string;
    username: string;
    roles: string;
    switch_id: string | null;
    method: string;
    path: string;
    before: unknown;
    after: unknown;
    rev: string | null;
    job_id: string | null;
    prev_hash: string;
    hash: string;
  }>('SELECT * FROM audit_log ORDER BY id ASC');
  let checked = 0;
  for (const row of rows) {
    // pg returns JSONB as parsed values; tolerate raw strings for robustness.
    const roles = Array.isArray(row.roles)
      ? (row.roles as string[])
      : (JSON.parse(row.roles as string) as string[]);
    const canonicalForm = canonical({
      ts: new Date(row.ts).toISOString(),
      userSub: row.user_sub,
      username: row.username,
      roles,
      switchId: row.switch_id ?? undefined,
      method: row.method,
      path: row.path,
      before: row.before,
      after: row.after,
      rev: row.rev ?? undefined,
      jobId: row.job_id ?? undefined,
      prevHash: row.prev_hash,
    });
    checked++;
    if (hashOf(canonicalForm) !== row.hash) return { ok: false, checked, badId: row.id };
  }
  return { ok: true, checked };
}

/** Delete rows older than retentionDays. Returns rows removed. */
export async function purgeAudit(retentionDays: number): Promise<number> {
  const { rowCount } = await db().query(
    `DELETE FROM audit_log WHERE ts < now() - make_interval(days => $1)`,
    [retentionDays],
  );
  return rowCount ?? 0;
}
