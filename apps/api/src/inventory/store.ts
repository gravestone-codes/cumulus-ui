/**
 * Fleet inventory store (roadmap 0.4: ConnectionManager data layer).
 * Switches, groups, membership, and TOFU certificate fingerprints.
 */
import { createHash } from 'node:crypto';
import { connect } from 'node:tls';
import { z } from 'zod';
import { db } from '../db.js';

export const SwitchSchema = z.object({
  id: z.string().min(1).max(64),
  display_name: z.string().min(1).max(128),
  base_url: z.string().url().startsWith('https://'),
  base_path: z.string().startsWith('/').default('/nvue_v1'),
  cert_fingerprint: z.string().nullable().default(null),
  cert_pem: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
});
export type Switch = z.infer<typeof SwitchSchema>;

export const GroupSchema = z.object({
  id: z.string().min(1).max(64),
  display_name: z.string().min(1).max(128),
  parent_id: z.string().nullable().default(null),
});
export type Group = z.infer<typeof GroupSchema>;

interface SwitchRow {
  id: string;
  display_name: string;
  base_url: string;
  base_path: string;
  cert_fingerprint: string | null;
  cert_pem: string | null;
  enabled: boolean;
  groups: string[] | null;
}

function toSwitch(row: SwitchRow): Switch & { groups: string[] } {
  return {
    id: row.id,
    display_name: row.display_name,
    base_url: row.base_url,
    base_path: row.base_path,
    cert_fingerprint: row.cert_fingerprint,
    cert_pem: row.cert_pem,
    enabled: row.enabled,
    groups: row.groups ?? [],
  };
}

const WITH_GROUPS = `SELECT s.*, COALESCE(array_agg(sg.group_id) FILTER (WHERE sg.group_id IS NOT NULL), '{}') AS groups
  FROM switches s LEFT JOIN switch_groups sg ON sg.switch_id = s.id`;

/** Fetch one switch with its groups. Returns null when unknown. */
export async function getSwitch(switchId: string): Promise<(Switch & { groups: string[] }) | null> {
  const { rows } = await db().query<SwitchRow>(`${WITH_GROUPS} WHERE s.id = $1 GROUP BY s.id`, [switchId]);
  const row = rows[0];
  return row ? toSwitch(row) : null;
}

/** List all switches with their group ids. */
export async function listSwitches(): Promise<Array<Switch & { groups: string[] }>> {
  const { rows } = await db().query<SwitchRow>(`${WITH_GROUPS} GROUP BY s.id ORDER BY s.id`);
  return rows.map(toSwitch);
}

export interface SwitchIdentity {
  fingerprint: string;
  pem: string;
}

/** DER bytes → PEM block. */
function derToPem(der: Buffer): string {
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g) ?? [b64];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/** Insert a switch. Without any identity, capture both live (TOFU enrolment);
 * partial explicit identity is stored as-is (connection stays refused until re-enrol fills the gap). */
export async function createSwitch(input: unknown): Promise<Switch & { groups: string[] }> {
  const parsed = SwitchSchema.omit({ cert_fingerprint: true, cert_pem: true })
    .extend({
      cert_fingerprint: z.string().nullable().optional(),
      cert_pem: z.string().nullable().optional(),
    })
    .parse(input);
  const identity: SwitchIdentity | { fingerprint: string | null; pem: string | null } =
    parsed.cert_fingerprint && parsed.cert_pem
      ? { fingerprint: parsed.cert_fingerprint, pem: parsed.cert_pem }
      : !parsed.cert_fingerprint && !parsed.cert_pem
        ? await captureIdentity(parsed.base_url)
        : { fingerprint: parsed.cert_fingerprint ?? null, pem: parsed.cert_pem ?? null };
  const { rows } = await db().query<SwitchRow>(
    `INSERT INTO switches (id, display_name, base_url, base_path, cert_fingerprint, cert_pem)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *, '{}' AS groups`,
    [parsed.id, parsed.display_name, parsed.base_url, parsed.base_path, identity.fingerprint, identity.pem],
  );
  const row = rows[0];
  if (!row) throw new Error('insert returned no row');
  return toSwitch(row);
}

/** Capture the live identity (fingerprint + PEM) of a switch. Pure TLS — no NVUE auth needed. */
export function captureIdentity(baseUrl: string): Promise<SwitchIdentity> {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const socket = connect(
      { host: hostname, port: Number(port) || 443, rejectUnauthorized: false, servername: hostname },
      () => {
        try {
          const cert = socket.getPeerCertificate(true);
          socket.destroy();
          if (!cert?.raw) return reject(new Error('no certificate presented'));
          resolve({
            fingerprint: `SHA256:${createHash('sha256').update(cert.raw).digest('hex').toUpperCase()}`,
            pem: derToPem(cert.raw),
          });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      },
    );
    socket.setTimeout(8000, () => {
      socket.destroy(new Error('fingerprint capture timed out'));
    });
    socket.on('error', reject);
  });
}

/** Verify a presented fingerprint against the stored TOFU pin. Pure — unit-tested. */
export function verifyFingerprint(stored: string | null, presented: string): boolean {
  if (!stored) return false; // not enrolled → refuse, never blind-trust
  return stored.toUpperCase() === presented.toUpperCase();
}

/** Attach a switch to groups (replaces membership). */
export async function setSwitchGroups(switchId: string, groupIds: string[]): Promise<void> {
  const pool = db();
  await pool.query('BEGIN');
  try {
    await pool.query('DELETE FROM switch_groups WHERE switch_id = $1', [switchId]);
    for (const gid of groupIds) {
      await pool.query('INSERT INTO switch_groups (switch_id, group_id) VALUES ($1, $2)', [switchId, gid]);
    }
    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }
}

/** Delete a switch (membership cascades). Returns true if anything was deleted. */
export async function deleteSwitch(switchId: string): Promise<boolean> {
  const { rowCount } = await db().query('DELETE FROM switches WHERE id = $1', [switchId]);
  return (rowCount ?? 0) > 0;
}

/** List all groups. */
export async function listGroups(): Promise<Group[]> {
  const { rows } = await db().query<Group>('SELECT id, display_name, parent_id FROM groups ORDER BY id');
  return rows;
}

/** Insert a group. */
export async function createGroup(input: unknown): Promise<Group> {
  const parsed = GroupSchema.parse(input);
  const { rows } = await db().query<Group>(
    'INSERT INTO groups (id, display_name, parent_id) VALUES ($1, $2, $3) RETURNING id, display_name, parent_id',
    [parsed.id, parsed.display_name, parsed.parent_id],
  );
  const row = rows[0];
  if (!row) throw new Error('insert returned no row');
  return row;
}
