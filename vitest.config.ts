import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every workspace that defines a vitest.config.ts is a project; workspaces
    // without one (packages/config) are simply not test targets.
    projects: [
      'apps/*/vitest.config.ts',
      'packages/*/vitest.config.ts',
      'scripts/vitest.config.ts',
    ],
    passWithNoTests: true,
  },
});
