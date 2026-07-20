// SSG mode (ADR-0001): the portfolio is fully statically generated
// (`nuxt generate`) with Nuxt Content — no runtime backend, deployable to any
// static host. Unlike apps/web (SPA, ssr:false), SSR/prerender is ON so pages
// are pre-rendered to static HTML at build time. The module-boundary wall
// (ARCHITECTURE §2, eslint ANY_INTERNAL) keeps this app free of every platform
// package and all private data — it builds with zero access to apps/api or the
// database. See README.md for the deploy path and the env-driven base URL.
export default defineNuxtConfig({
  modules: ['@nuxt/content'],
  content: {
    // Build-time SQLite adapter = Node's built-in `node:sqlite` (Node 24, our
    // pinned .nvmrc). Content's default adapter is the NATIVE better-sqlite3,
    // which it auto-installs on first build — that would fight the repo's
    // `allowBuilds: false` discipline (pnpm-workspace.yaml) and add a native
    // compile to every CI install. `native` needs no dependency and no build
    // script; the bundled @sqlite.org/sqlite-wasm still serves client queries.
    experimental: { sqliteConnector: 'native' },
  },
  compatibilityDate: '2026-07-19',
  telemetry: false,
  // Own port outside the 4300–4311 web/api/e2e range (binventory owns :3000
  // and its neighborhood). Guarded by scripts/assert-port-free.mjs, wired into
  // the dev script — Nuxt/listhen has no strict-port option (the M0-10 finding).
  devServer: { port: 4320 },
  // Base URL is env-driven (NUXT_APP_BASE_URL, honored natively by Nuxt): the
  // `generate:pages` script sets it to /careerforge/ for the GitHub Pages
  // project site; plain `nuxt generate` (and the future apex domain) default
  // to /. Not hard-coded here so the domain cutover is a one-line change.
  typescript: {
    strict: true,
  },
});
