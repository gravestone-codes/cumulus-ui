/**
 * Boots the real API for e2e (explicit spawn — no webServer-array magic).
 * Waits for /health, kills the child afterwards. Fails loudly on any problem.
 */
import { spawn, type ChildProcess } from 'node:child_process';

let child: ChildProcess | null = null;

async function waitForHealth(url: string, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`API never came up at ${url}`);
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  child = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
    cwd: new URL('../../api', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: '3000',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://cumulus:cumulus@127.0.0.1:5433/cumulus',
      SWITCH_CRED_KEY: process.env.SWITCH_CRED_KEY ?? 'e2e-cred-key-long-enough-1234567890',
      LOG_LEVEL: 'warn',
    },
    stdio: 'inherit',
  });
  await waitForHealth('http://127.0.0.1:3000/api/v1/health');
  return async () => {
    child?.kill('SIGTERM');
    child = null;
  };
}
