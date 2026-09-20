import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:4173' },
  globalSetup: './e2e/global-setup.ts',
  webServer: {
    // Vite dev (not preview): DEV-only UI (reset button) must render.
    // The API boots in global-setup (explicit, logged) — not here.
    command: 'pnpm dev --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
