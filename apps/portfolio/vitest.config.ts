import { fileURLToPath } from 'node:url';

import { defineVitestProject } from '@nuxt/test-utils/config';

// The `nuxt` environment builds the real app for the runtime tests (the home
// page renders) — the root vitest config picks this project up like every
// other workspace, so rootDir must point HERE explicitly (the root runner's
// cwd is the repo root, where no nuxt app lives).
export default defineVitestProject({
  test: {
    name: 'app-portfolio',
    environment: 'nuxt',
    exclude: ['node_modules/**'],
    // Fresh-clone guard: writes .nuxt/ (which tsconfig.json extends) before
    // any .ts test file is transformed — see the setup file's comment.
    globalSetup: './tests/setup/prepare-nuxt.mjs',
    environmentOptions: {
      nuxt: {
        rootDir: fileURLToPath(new URL('.', import.meta.url)),
      },
    },
  },
});
