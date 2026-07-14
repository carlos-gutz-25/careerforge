import base from '@careerforge/config/vitest';
import { defineProject, mergeConfig } from 'vitest/config';

export default mergeConfig(
  base,
  defineProject({
    test: {
      name: 'db',
      // Integration tests share the one careerforge_test database, so test
      // files run serially. Fine at this size; if the suite gets slow, that's
      // the trigger to revisit (ADR-0004 style), not before.
      fileParallelism: false,
      globalSetup: './src/test/global-setup.ts',
      // app-api's integration tests (groupOrder 2) share careerforge_test;
      // Vitest runs projects in parallel unless staged, and cross-project
      // TRUNCATEs would race. Same revisit trigger as above.
      sequence: { groupOrder: 1 },
    },
  }),
);
