import { defineConfig } from '@playwright/test';

/** Hardware e2e (M1): drives a deployed instance with real switches; no local servers. */
export default defineConfig({
  testDir: './e2e-hw',
  timeout: 300_000,
  use: { baseURL: process.env.HW_URL, viewport: { width: 1280, height: 860 } },
});
