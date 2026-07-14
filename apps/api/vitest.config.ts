import base from '@careerforge/config/vitest';
import { defineProject, mergeConfig } from 'vitest/config';

export default mergeConfig(
  base,
  defineProject({
    test: {
      name: 'app-api',
      // Auth integration tests share careerforge_test with the db project:
      // serial files within the project, and groupOrder stages this project
      // after db (Vitest runs projects in parallel otherwise, and
      // cross-project TRUNCATEs would race). Same revisit-if-slow trigger as
      // packages/db (ADR-0004 style).
      fileParallelism: false,
      globalSetup: './src/test/global-setup.ts',
      sequence: { groupOrder: 2 },
    },
  }),
);
