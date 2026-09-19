/**
 * PermissionGate + RoleManager data layer (roadmap 0.8: R2c/R2d).
 * Roles are rows, not code. The gate itself is pure — fully unit-tested
 * without a database; the store functions hydrate it.
 */
import { z } from 'zod';
import { db } from '../db.js';

export interface Rule {
  method: string;
  path_prefix: string;
}

export interface Role {
  id: string;
  display_name: string;
  description: string;
  system: boolean;
  can_dangerous: boolean;
  rules: Rule[];
  /** Empty = global scope; otherwise switch must sit in one of these groups. */
  groups: string[];
}

/** §6.6 dangerous class, enforced below every role table: only can_dangerous roles pass. */
export const DANGEROUS_PREFIXES = [
  '/system/factory-default',
  '/system/image',
  '/system/packages',
  '/system/aaa',
  '/system/security',
];

export interface GateCall {
  method: string;
  /** Full path as it will hit the switch or our own API. */
  path: string;
  /** Groups of the target switch; omitted for our own API paths. */
  switchGroups?: string[];
}

/**
 * Deny-by-default decision. Pure. A call passes when some role grants
 * (method, prefix-match) within scope, and dangerous paths additionally
 * require can_dangerous. UI hiding is cosmetic — this is the control.
 */
export function gateCheck(roles: Role[], call: GateCall): boolean {
  const method = call.method.toUpperCase();
  const dangerous = DANGEROUS_PREFIXES.some((p) => call.path === p || call.path.startsWith(`${p}/`));
  // Our API and NVUE paths are separate namespaces: a broad NVUE grant such as
  // GET / must never spill onto /api/v1/*, and vice versa.
  const ours = call.path.startsWith('/api/');
  for (const role of roles) {
    if (dangerous && !role.can_dangerous) continue;
    const inScope =
      role.groups.length === 0 ||
      call.switchGroups === undefined ||
      call.switchGroups.some((g) => role.groups.includes(g));
    if (!inScope) continue;
    if (
      role.rules.some(
        (r) =>
          r.method === method &&
          r.path_prefix.startsWith('/api/') === ours &&
          call.path.startsWith(r.path_prefix),
      )
    ) {
      return true;
    }
  }
  return false;
}

interface RoleRow {
  id: string;
  display_name: string;
  description: string;
  system: boolean;
  can_dangerous: boolean;
}

/** Hydrate roles (with rules + groups) for a user sub. Empty array = no access at all. */
export async function getUserRoles(userSub: string): Promise<Role[]> {
  const { rows } = await db().query<RoleRow>(
    `SELECT r.* FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_sub = $1`,
    [userSub],
  );
  return Promise.all(rows.map(hydrate));
}

async function hydrate(row: RoleRow): Promise<Role> {
  const pool = db();
  const [rules, groups] = await Promise.all([
    pool.query<Rule>('SELECT method, path_prefix FROM role_rules WHERE role_id = $1', [row.id]),
    pool.query<{ group_id: string }>('SELECT group_id FROM role_groups WHERE role_id = $1', [row.id]),
  ]);
  return {
    id: row.id,
    display_name: row.display_name,
    description: row.description,
    system: row.system,
    can_dangerous: row.can_dangerous,
    rules: rules.rows,
    groups: groups.rows.map((g) => g.group_id),
  };
}

/** List all roles (admin view). */
export async function listRoles(): Promise<Role[]> {
  const { rows } = await db().query<RoleRow>('SELECT * FROM roles ORDER BY id');
  return Promise.all(rows.map(hydrate));
}

export const CustomRoleSchema = z.object({
  id: z.string().min(1).max(64),
  display_name: z.string().min(1).max(128),
  description: z.string().max(512).default(''),
  can_dangerous: z.boolean().default(false),
  rules: z
    .array(z.object({ method: z.string().min(1), path_prefix: z.string().startsWith('/') }))
    .default([]),
  groups: z.array(z.string()).default([]),
});
export type CustomRole = z.infer<typeof CustomRoleSchema>;

/** Create a custom role. System ids are reserved. */
export async function createRole(input: unknown): Promise<Role> {
  const parsed = CustomRoleSchema.parse(input);
  const pool = db();
  const existing = await pool.query('SELECT system FROM roles WHERE id = $1', [parsed.id]);
  if (existing.rowCount !== 0)
    throw Object.assign(new Error('role id taken or reserved'), { code: 'ROLE_TAKEN' });
  await pool.query('BEGIN');
  try {
    await pool.query(
      'INSERT INTO roles (id, display_name, description, system, can_dangerous) VALUES ($1, $2, $3, false, $4)',
      [parsed.id, parsed.display_name, parsed.description, parsed.can_dangerous],
    );
    for (const r of parsed.rules) {
      await pool.query('INSERT INTO role_rules (role_id, method, path_prefix) VALUES ($1, $2, $3)', [
        parsed.id,
        r.method.toUpperCase(),
        r.path_prefix,
      ]);
    }
    for (const g of parsed.groups) {
      await pool.query('INSERT INTO role_groups (role_id, group_id) VALUES ($1, $2)', [parsed.id, g]);
    }
    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }
  const [role] = await listRoles().then((all) => all.filter((r) => r.id === parsed.id));
  if (!role) throw new Error('role vanished after create');
  return role;
}

/** Delete a custom role. System roles are immutable (prevents lockout). */
export async function deleteRole(id: string): Promise<'deleted' | 'system' | 'missing'> {
  const { rows } = await db().query<{ system: boolean }>('SELECT system FROM roles WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return 'missing';
  if (row.system) return 'system';
  await db().query('DELETE FROM roles WHERE id = $1', [id]);
  return 'deleted';
}

/** Grant/revoke a role to a user sub. */
export async function grantRole(userSub: string, roleId: string): Promise<void> {
  await db().query('INSERT INTO user_roles (user_sub, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
    userSub,
    roleId,
  ]);
}

/**
 * Whether any of the roles may touch a switch in the given groups.
 * Global roles (no groups) pass everywhere; scoped roles need an intersection.
 * Used pre-proxy for switch-connect decisions (full method/path gating is the proxy's job, Phase 1).
 */
export function mayAccessSwitch(roles: Role[], switchGroups: string[]): boolean {
  return roles.some((r) => r.groups.length === 0 || r.groups.some((g) => switchGroups.includes(g)));
}

/** Flatten a user's rules for UI gating hints (cosmetic — enforcement stays server-side). */
export function capabilities(roles: Role[]) {
  return {
    roles: roles.map((r) => r.id),
    can_dangerous: roles.some((r) => r.can_dangerous),
    rules: roles.flatMap((r) => r.rules.map((rule) => ({ ...rule, role: r.id }))),
    groups: [...new Set(roles.flatMap((r) => r.groups))],
  };
}
