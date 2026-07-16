import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import vue from 'eslint-plugin-vue';
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
const SERVER_PKGS = {
  group: ['@careerforge/db', '@careerforge/db/*', '@careerforge/llm', '@careerforge/llm/*'],
  message:
    'apps/web talks only to apps/api — @careerforge/core is its sole internal dependency (ARCHITECTURE §2).',
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
    // Prompt modules are static DATA (ADR-0006 layer 1): an interpolated
    // template literal in a prompt file is an interpolation site for runtime
    // text to enter prompt strings — banned mechanically. New behavior = new
    // version file, never a computed string. Second selector (external
    // review F1, PR #16): concatenation, builder calls, and references also
    // compose prompt text at runtime — system/instructions must be an INLINE
    // literal, so the shipped text is exactly what review reads.
    {
      files: ['packages/llm/src/registry/prompts/**'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'TemplateLiteral[expressions.length>0]',
            message:
              'Prompt text must be static — no interpolated template literals in prompt modules (ADR-0006 layer 1). New prompt behavior = new version file.',
          },
          {
            selector:
              'Property[key.name=/^(system|instructions)$/]:not([value.type=/^(Literal|TemplateLiteral)$/])',
            message:
              'system/instructions must be an inline string literal in the version module — no concatenation, builder calls, or references (ADR-0006 layer 1; external review F1). New prompt behavior = new version file.',
          },
        ],
      },
    },
    { files: ['packages/scoring/**'], rules: restrict(SQL, LLM_SDK, LLM_PKG) },
    { files: ['packages/core/**'], rules: restrict(SQL, LLM_SDK, ANY_INTERNAL) },
    { files: ['apps/portfolio/**'], rules: restrict(SQL, LLM_SDK, ANY_INTERNAL) },
    { files: ['apps/web/**'], rules: restrict(SQL, LLM_SDK, SERVER_PKGS) },
    // Vue single-file components (M0-10, apps/web). vue's flat/recommended
    // brings vue-eslint-parser; <script setup lang="ts"> blocks parse with
    // the TS parser but stay OUTSIDE type-aware linting (projectService and
    // .vue don't mix; `nuxt typecheck`/vue-tsc owns type safety there).
    ...vue.configs['flat/recommended'],
    {
      files: ['**/*.vue'],
      languageOptions: { parserOptions: { parser: tseslint.parser } },
      rules: {
        // LAW, not preference (M0-10 approval amendment): M1-02 renders
        // hostile posting text — escape-by-interpolation is architectural,
        // so v-html is banned before unfriendly data exists. Never weaken
        // this to 'warn'; add scoped disables only with a documented reason.
        'vue/no-v-html': 'error',
        // Nuxt auto-imports (ref, useRoute, app composables…) are invisible
        // to no-undef; undefined identifiers in SFCs are vue-tsc's job.
        'no-undef': 'off',
      },
    },
    {
      // Nuxt's file-based conventions force single-word names on route/layout
      // files; the rule stays ON for ordinary components/.
      files: [
        'apps/*/app/pages/**/*.vue',
        'apps/*/app/layouts/**/*.vue',
        'apps/*/app/app.vue',
        'apps/*/app/error.vue',
      ],
      rules: { 'vue/multi-word-component-names': 'off' },
    },
    // Config files and repo scripts sit outside any workspace tsconfig; skip
    // type-aware linting. apps/web/app is excluded too: its tsconfig extends
    // the GENERATED .nuxt/tsconfig.json (absent on a fresh clone until a
    // nuxt command runs), so type-aware lint would be flaky in CI — vue-tsc
    // covers apps/web types via `pnpm typecheck` instead.
    {
      files: [
        '**/*.config.{js,ts}',
        '**/eslint.config.js',
        'packages/config/**',
        'scripts/**',
        'apps/web/**/*.{ts,vue,mjs}',
      ],
      extends: [tseslint.configs.disableTypeChecked],
    },
    // Repo and app scripts run under plain Node; declare the globals they
    // use (the TS sources get these from the type checker instead). The
    // Playwright e2e harness scripts (apps/*/e2e/*.mjs, M1-02) are the same
    // species: plain-Node process supervisors outside any tsconfig.
    {
      files: ['scripts/**', 'apps/*/scripts/**', 'apps/*/e2e/**/*.mjs'],
      languageOptions: {
        globals: { process: 'readonly', URL: 'readonly', console: 'readonly' },
      },
    },
    prettierConfig,
  );
}
