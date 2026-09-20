/**
 * Platform users (roadmap: identities are created in our UI, never via IdP
 * redirect) plus the switch-credential extension: per-switch device logins
 * attached to a user, encrypted at rest. App-dead recovery is unchanged —
 * the same switch accounts work over SSH directly.
 */
import { scryptSync, timingSafeEqual, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db.js';
import { open, seal } from '../lib/sealed.js';

export interface PlatformUser {
  id: string;
  display_name: string;
  disabled: boolean;
}

interface UserRow extends PlatformUser {
  password_hash: string;
}

function parseHash(stored: string): { n: number; r: number; p: number; salt: string; hash: string } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [ns, rs, ps, salts, hashs] = parts.slice(1);
  if (!ns || !rs || !ps || !salts || !hashs) return null;
  return { n: Number(ns), r: Number(rs), p: Number(ps), salt: salts, hash: hashs };
}

/** scrypt hash for storage. Format: scrypt$N$r$p$salt$hash. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$16384$8$1$${salt}$${hash}`;
}

/** Constant-time verification. False for unknown users too (caller still hashes to flatten timing). */
export function verifyPassword(password: string, stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  let candidate: Buffer;
  try {
    candidate = scryptSync(password, parsed.salt, 32, { N: parsed.n, r: parsed.r, p: parsed.p });
  } catch {
    return false;
  }
  const expected = Buffer.from(parsed.hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export const CreateUserSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9._-]+$/i),
  display_name: z.string().min(1).max(128),
  password: z.string().min(12).max(256),
});
export type CreateUser = z.infer<typeof CreateUserSchema>;

/** Create a platform user. Throws USER_TAKEN on duplicate id. */
export async function createUser(input: unknown): Promise<PlatformUser> {
  const parsed = CreateUserSchema.parse(input);
  const id = parsed.id.toLowerCase();
  try {
    const { rows } = await db().query<PlatformUser>(
      `INSERT INTO users (id, display_name, password_hash) VALUES ($1, $2, $3)
       RETURNING id, display_name, disabled`,
      [id, parsed.display_name, hashPassword(parsed.password)],
    );
    const row = rows[0];
    if (!row) throw new Error('insert returned no row');
    return row;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw Object.assign(new Error('user id taken'), { code: 'USER_TAKEN' });
    }
    throw err;
  }
}

/** Verify credentials. Returns the user on success, null otherwise (unknown user included). */
export async function verifyUser(id: string, password: string): Promise<PlatformUser | null> {
  const { rows } = await db().query<UserRow>('SELECT * FROM users WHERE id = $1', [id.toLowerCase()]);
  const row = rows[0];
  if (!row || row.disabled) {
    hashPassword(`dummy-${password.length}`); // flatten timing against enumeration
    return null;
  }
  return verifyPassword(password, row.password_hash)
    ? { id: row.id, display_name: row.display_name, disabled: row.disabled }
    : null;
}

/** List users (never hashes). */
export async function listUsers(): Promise<PlatformUser[]> {
  const { rows } = await db().query<PlatformUser>('SELECT id, display_name, disabled FROM users ORDER BY id');
  return rows;
}

/** Fetch one user by id (never the hash). Null when unknown. */
export async function getUserById(id: string): Promise<PlatformUser | null> {
  const { rows } = await db().query<PlatformUser>(
    'SELECT id, display_name, disabled FROM users WHERE id = $1',
    [id.toLowerCase()],
  );
  return rows[0] ?? null;
}

/** Update display name / disabled / password. Returns null when unknown. */
export async function updateUser(
  id: string,
  patch: { display_name?: string; disabled?: boolean; password?: string },
): Promise<PlatformUser | null> {
  const sets: string[] = ['updated_at = now()'];
  const args: unknown[] = [];
  if (patch.display_name !== undefined) {
    args.push(patch.display_name);
    sets.push(`display_name = $${args.length}`);
  }
  if (patch.disabled !== undefined) {
    args.push(patch.disabled);
    sets.push(`disabled = $${args.length}`);
  }
  if (patch.password !== undefined) {
    if (patch.password.length < 12)
      throw Object.assign(new Error('password too short'), { code: 'WEAK_PASSWORD' });
    args.push(hashPassword(patch.password));
    sets.push(`password_hash = $${args.length}`);
  }
  args.push(id.toLowerCase());
  const { rows } = await db().query<PlatformUser>(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${args.length} RETURNING id, display_name, disabled`,
    args,
  );
  return rows[0] ?? null;
}

/** Delete a user (roles, sessions, switch credentials cascade via FK + cleanup). Returns true when deleted. */
export async function deleteUser(id: string): Promise<boolean> {
  const pool = db();
  await pool.query('DELETE FROM user_roles WHERE user_sub = $1', [id.toLowerCase()]);
  await pool.query('DELETE FROM sessions WHERE user_sub = $1', [id.toLowerCase()]);
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id.toLowerCase()]);
  return (rowCount ?? 0) > 0;
}

export interface SwitchCredential {
  switchUsername: string;
  password: string;
}

/** Attach (or replace) a switch credential extension. Password is sealed before storage. */
export async function setSwitchCredential(
  userSub: string,
  switchId: string,
  switchUsername: string,
  password: string,
  credKey: string,
): Promise<void> {
  await db().query(
    `INSERT INTO switch_credentials (user_sub, switch_id, switch_username, password_enc)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_sub, switch_id) DO UPDATE SET switch_username = $3, password_enc = $4, updated_at = now()`,
    [userSub.toLowerCase(), switchId, switchUsername, seal(credKey, password)],
  );
}

/** Read a switch credential extension. Null when absent. */
export async function getSwitchCredential(
  userSub: string,
  switchId: string,
  credKey: string,
): Promise<SwitchCredential | null> {
  const { rows } = await db().query<{ switch_username: string; password_enc: string }>(
    'SELECT switch_username, password_enc FROM switch_credentials WHERE user_sub = $1 AND switch_id = $2',
    [userSub.toLowerCase(), switchId],
  );
  const row = rows[0];
  if (!row) return null;
  return { switchUsername: row.switch_username, password: open(credKey, row.password_enc) };
}

/** List switches a user holds credentials for (usernames only — never passwords). */
export async function listSwitchCredentials(
  userSub: string,
): Promise<Array<{ switchId: string; switchUsername: string }>> {
  const { rows } = await db().query<{ switch_id: string; switch_username: string }>(
    'SELECT switch_id, switch_username FROM switch_credentials WHERE user_sub = $1 ORDER BY switch_id',
    [userSub.toLowerCase()],
  );
  return rows.map((r) => ({ switchId: r.switch_id, switchUsername: r.switch_username }));
}

/** Drop one switch credential extension. */
export async function deleteSwitchCredential(userSub: string, switchId: string): Promise<void> {
  await db().query('DELETE FROM switch_credentials WHERE user_sub = $1 AND switch_id = $2', [
    userSub.toLowerCase(),
    switchId,
  ]);
}
