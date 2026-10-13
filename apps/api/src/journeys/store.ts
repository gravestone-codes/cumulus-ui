/**
 * Journey run persistence (migration 022). Rows are personal: every query is
 * keyed by the owner, so one user can never read or advance another's run.
 * Saves are optimistic — a stale version (second tab) is refused, not merged.
 */
import { db } from '../db.js';
import type { RunState, RunStatus, StepState, Values } from './engine.js';

export interface Scope {
  kind: 'switch' | 'group';
  id: string;
}

export interface RunRow {
  id: string;
  journey: string;
  scope: Scope;
  members: string[];
  run: RunState;
  auditId: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface DbRow {
  id: string;
  journey: string;
  scope_kind: 'switch' | 'group';
  scope_id: string;
  members: string[];
  state: RunStatus;
  current: string | null;
  steps: Record<string, StepState>;
  vals: Values;
  note: string | null;
  audit_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const toRow = (r: DbRow): RunRow => ({
  id: String(r.id),
  journey: r.journey,
  scope: { kind: r.scope_kind, id: r.scope_id },
  members: r.members,
  run: { state: r.state, current: r.current, steps: r.steps, values: r.vals, note: r.note },
  auditId: r.audit_id === null ? null : Number(r.audit_id),
  version: r.version,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/** A run whose version moved since it was read (another tab advanced it). */
export class StaleRunError extends Error {}

export async function createRun(
  userSub: string,
  journey: string,
  scope: Scope,
  members: string[],
  run: RunState,
): Promise<RunRow> {
  const { rows } = await db().query<DbRow>(
    `INSERT INTO journey_runs (user_sub, journey, scope_kind, scope_id, members, state, current, steps, vals, note)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb, $10) RETURNING *`,
    [
      userSub,
      journey,
      scope.kind,
      scope.id,
      JSON.stringify(members),
      run.state,
      run.current,
      JSON.stringify(run.steps),
      JSON.stringify(run.values),
      run.note,
    ],
  );
  return toRow(rows[0] as DbRow);
}

/** The owner's run, or null (someone else's id reads as absent). */
export async function getRun(id: string, userSub: string): Promise<RunRow | null> {
  if (!/^\d{1,18}$/.test(id)) return null;
  const { rows } = await db().query<DbRow>('SELECT * FROM journey_runs WHERE id = $1 AND user_sub = $2', [
    id,
    userSub,
  ]);
  return rows[0] ? toRow(rows[0]) : null;
}

/** The owner's unfinished run of one journey in one scope: starting again resumes it. */
export async function findActive(userSub: string, journey: string, scope: Scope): Promise<RunRow | null> {
  const { rows } = await db().query<DbRow>(
    `SELECT * FROM journey_runs WHERE user_sub = $1 AND journey = $2 AND scope_kind = $3 AND scope_id = $4
       AND state IN ('in-progress', 'blocked') ORDER BY updated_at DESC LIMIT 1`,
    [userSub, journey, scope.kind, scope.id],
  );
  return rows[0] ? toRow(rows[0]) : null;
}

/** The owner's recent runs, newest first, optionally in one scope. */
export async function listRuns(userSub: string, scope?: Scope, limit = 30): Promise<RunRow[]> {
  const { rows } = scope
    ? await db().query<DbRow>(
        `SELECT * FROM journey_runs WHERE user_sub = $1 AND scope_kind = $2 AND scope_id = $3
         ORDER BY updated_at DESC LIMIT $4`,
        [userSub, scope.kind, scope.id, limit],
      )
    : await db().query<DbRow>(
        'SELECT * FROM journey_runs WHERE user_sub = $1 ORDER BY updated_at DESC LIMIT $2',
        [userSub, limit],
      );
  return rows.map(toRow);
}

/**
 * Persist a new state over the version it was computed from.
 * @throws StaleRunError when another request saved first
 */
export async function saveRun(row: RunRow, userSub: string, run: RunState): Promise<RunRow> {
  const { rows } = await db().query<DbRow>(
    `UPDATE journey_runs SET state = $1, current = $2, steps = $3::jsonb, vals = $4::jsonb, note = $5,
       version = version + 1, updated_at = now()
     WHERE id = $6 AND user_sub = $7 AND version = $8 RETURNING *`,
    [
      run.state,
      run.current,
      JSON.stringify(run.steps),
      JSON.stringify(run.values),
      run.note,
      row.id,
      userSub,
      row.version,
    ],
  );
  if (!rows[0]) throw new StaleRunError('this journey moved on in another tab — reload it');
  return toRow(rows[0]);
}

/** Link a finished run to its journey audit entry (written after the terminal save). */
export async function linkAudit(row: RunRow, auditId: number): Promise<RunRow> {
  const { rows } = await db().query<DbRow>(
    'UPDATE journey_runs SET audit_id = $1 WHERE id = $2 RETURNING *',
    [auditId, row.id],
  );
  return rows[0] ? toRow(rows[0]) : { ...row, auditId };
}
