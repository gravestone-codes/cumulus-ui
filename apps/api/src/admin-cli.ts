/**
 * create-admin CLI: seeds the first app administrator. Usage:
 *   pnpm --filter @cumulus/api create-admin -- --username boss --password '...' [--display 'Boss']
 * Prints nothing secret. Exit non-zero on duplicates.
 */
import { migrate } from './db.js';
import { createUser } from './users/store.js';
import { grantRole } from './rbac/store.js';

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const username = arg('username');
const password = arg('password');
const display = arg('display') ?? username;
if (!username || !password) {
  console.error("usage: create-admin -- --username <id> --password <min-12-chars> [--display 'Name']");
  process.exit(2);
}

await migrate();
const user = await createUser({ id: username, display_name: display, password });
await grantRole(user.id, 'app-admin');
console.log(JSON.stringify({ created: user.id }));
process.exit(0);
