import { defineConfig } from 'vitest/config';

// Test project for root-level scripts (privacy-check.mjs). Registered in the
// root vitest.config.ts `projects` list so `pnpm test` runs it in CI.
export default defineConfig({
  test: {
    name: 'scripts',
    include: ['*.test.mjs'],
    // The privacy-check integration test spins up scratch git repos; give it room.
    testTimeout: 20000,
  },
});
