import { defineProject } from 'vitest/config';

// Shared per-workspace vitest defaults. The root vitest.config.ts discovers every
// workspace's vitest.config.ts as a project and runs them in one pass (ADR-0004:
// no orchestrator — one process beats 8).
export default defineProject({
  test: {
    environment: 'node',
  },
});
