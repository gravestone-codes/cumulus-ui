import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // One shared Postgres: files run sequentially to avoid cross-file races
    // (setup-emptiness, dev-reset wipes, id collisions). Measured cost: ~2x wall time.
    maxWorkers: 1,
  },
});
