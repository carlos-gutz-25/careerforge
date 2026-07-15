// Vitest globalSetup (plain JS on purpose — it must transform WITHOUT a
// tsconfig, which is exactly what it exists to create). On a fresh clone
// (CI's `test` job) the generated .nuxt/tsconfig.json doesn't exist yet, and
// apps/web/tsconfig.json extends it — esbuild's transform of the .ts test
// files then fails hard with TSCONFIG_ERROR (first seen on PR CI, reproduced
// locally by deleting .nuxt/). The vitest nuxt ENVIRONMENT builds into its
// own test build dir, so it never writes .nuxt/ — `nuxt prepare` here does,
// once, before any test file is transformed.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

const appDir = fileURLToPath(new URL('../..', import.meta.url));

export default function prepareNuxt() {
  if (!existsSync(new URL('../../.nuxt/tsconfig.json', import.meta.url))) {
    execSync('npx nuxt prepare', { cwd: appDir, stdio: 'inherit' });
  }
}
