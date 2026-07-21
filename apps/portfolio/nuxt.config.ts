// SSG mode (ADR-0001): the portfolio is fully statically generated
// (`nuxt generate`) with Nuxt Content — no runtime backend, deployable to any
// static host. Unlike apps/web (SPA, ssr:false), SSR/prerender is ON so pages
// are pre-rendered to static HTML at build time. The module-boundary wall
// (ARCHITECTURE §2, eslint ANY_INTERNAL) keeps this app free of every platform
// package and all private data — it builds with zero access to apps/api or the
// database. See README.md for the deploy path.
//
// Base URL defaults to `/` — the site serves from the apex root (custom domain
// carlosgutz.com; ADR-0008 amended 2026-07-20, M2-11 dropped the `/careerforge/`
// project-site subpath). It remains env-driven (NUXT_APP_BASE_URL, honored
// natively by Nuxt) but no build sets a prefix anymore. It is deliberately NOT a
// config key here. (F8: this note previously dangled above `typescript:`,
// annotating a key it did not describe; relocated here.)
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
  // Global stylesheets, tokens FIRST so base.css can consume them (D2/D5).
  css: ['~/assets/css/tokens.css', '~/assets/css/base.css'],
  app: {
    head: {
      // Static only — app.head is serialized, so no functions here. The
      // function titleTemplate lives in app.vue via useHead (F5).
      htmlAttrs: { lang: 'en' },
      // Declaring rel="icon" stops the browser's default /favicon.ico probe,
      // which 404'd and failed Lighthouse `errors-in-console` (best-practices
      // 96→100 — the M2-03 gate surfaced it). SVG-only mark; public/favicon.svg.
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
      meta: [
        // System-preference dark mode (no toggle): the browser chrome follows
        // the OS via matched media queries. Values mirror --color-bg.
        { name: 'theme-color', content: '#ffffff', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#14141a', media: '(prefers-color-scheme: dark)' },
      ],
    },
  },
  compatibilityDate: '2026-07-19',
  telemetry: false,
  // Own port outside the 4300–4311 web/api/e2e range (binventory owns :3000
  // and its neighborhood). Guarded by scripts/assert-port-free.mjs, wired into
  // the dev script — Nuxt/listhen has no strict-port option (the M0-10 finding).
  devServer: { port: 4320 },
  typescript: {
    strict: true,
  },
});
