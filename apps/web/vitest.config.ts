import { fileURLToPath } from 'node:url';

import { defineVitestProject } from '@nuxt/test-utils/config';

// The `nuxt` environment builds the real app for the runtime tests (auth
// guard, pages) — the root vitest config picks this project up like every
// other workspace, so rootDir must point HERE explicitly (the root runner's
// cwd is the repo root, where no nuxt app lives). Pure utility tests opt
// back down to node per-file via `// @vitest-environment node`.
export default defineVitestProject({
  test: {
    name: 'app-web',
    environment: 'nuxt',
    environmentOptions: {
      nuxt: {
        rootDir: fileURLToPath(new URL('.', import.meta.url)),
      },
    },
  },
});
