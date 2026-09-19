import { Pool } from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pool: Pool | null = null;

/** Shared pg pool. Created on first use from DATABASE_URL. */
export function db(): Pool {
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

/** Apply pending SQL migrations in filename order. Safe to run on every boot,
 * including concurrently: a session-level advisory lock serializes migrators,
 * and each migration runs in its own transaction. */
export async function migrate(target: Pool = db()): Promise<string[]> {
  const client = await target.connect();
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    await client.query(`SELECT pg_advisory_lock(hashtext('cumulus-migrate'))`);
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
    const applied: string[] = [];
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith('.sql') || done.has(file)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    return applied;
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext('cumulus-migrate'))`).catch(() => undefined);
    client.release();
  }
}
