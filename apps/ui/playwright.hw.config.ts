import { defineConfig } from '@playwright/test';

/** Hardware e2e (M1/M1b): drives a deployed instance with real switches; no local servers. */
export default defineConfig({
  testDir: './e2e-hw',
  // Specs share one lab interface — run them one at a time.
  workers: 1,
  timeout: 300_000,
  use: { baseURL: process.env.HW_URL, viewport: { width: 1280, height: 860 } },
});
