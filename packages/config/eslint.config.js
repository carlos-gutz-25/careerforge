import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

// Module-boundary restrictions (ARCHITECTURE.md §2). `no-restricted-imports` is not
// additive across config blocks — the LAST matching block wins — so each directory
// block below must list the FULL set of restrictions that apply to it.
const SQL = {
  group: ['drizzle-orm', 'drizzle-orm/*', 'postgres', 'pg'],
  message: 'SQL/Drizzle lives only in packages/db (ARCHITECTURE §2).',
};
const LLM_SDK = {
  group: ['@anthropic-ai/*', 'openai', 'openai/*'],
  message: 'LLM provider SDKs live only in packages/llm (ARCHITECTURE §2).',
};
const LLM_PKG = {
  group: ['@careerforge/llm', '@careerforge/llm/*'],
  message: 'packages/scoring is deterministic and never imports packages/llm (hard rule).',
};
const ANY_INTERNAL = {
  // @careerforge/config is exempt: it is build tooling, not a platform package.
  group: ['@careerforge/*', '!@careerforge/config', '!@careerforge/config/*'],
  message: 'This workspace must not depend on internal packages (ARCHITECTURE §2).',
};

const restrict = (...patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

/**
 * Shared flat ESLint config, consumed once by the root eslint.config.js.
 * @param {{ tsconfigRootDir: string }} options
 */
export function createConfig({ tsconfigRootDir }) {
  return tseslint.config(
    {
      ignores: ['**/node_modules/', '**/dist/', '**/coverage/', '**/.output/', '**/.nuxt/'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
      },
      // Only import-x rules that work on syntax alone — resolution-dependent rules
      // (no-unresolved, namespace, …) would need a second resolver that duplicates
      // what tsc already checks with full workspace/exports awareness.
      plugins: { 'import-x': importX },
      rules: {
        'import-x/no-duplicates': 'error',
        'import-x/first': 'error',
        'import-x/newline-after-import': 'error',
      },
    },
    // Default boundary wall: SQL and LLM SDKs are quarantined everywhere...
    { files: ['**/*.ts', '**/*.js'], rules: restrict(SQL, LLM_SDK) },
    // ...except in their home packages, which drop only their own restriction.
    { files: ['packages/db/**'], rules: restrict(LLM_SDK) },
    { files: ['packages/llm/**'], rules: restrict(SQL) },
    { files: ['packages/scoring/**'], rules: restrict(SQL, LLM_SDK, LLM_PKG) },
    { files: ['packages/core/**'], rules: restrict(SQL, LLM_SDK, ANY_INTERNAL) },
    { files: ['apps/portfolio/**'], rules: restrict(SQL, LLM_SDK, ANY_INTERNAL) },
    // Config files and repo scripts sit outside any workspace tsconfig; skip
    // type-aware linting.
    {
      files: ['**/*.config.{js,ts}', '**/eslint.config.js', 'packages/config/**', 'scripts/**'],
      extends: [tseslint.configs.disableTypeChecked],
    },
    // Repo scripts run under plain Node; declare the globals they use (the
    // TS sources get these from the type checker instead).
    {
      files: ['scripts/**'],
      languageOptions: { globals: { process: 'readonly', URL: 'readonly' } },
    },
    prettierConfig,
  );
}
