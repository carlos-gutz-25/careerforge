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
  // Order: tokens (vars) -> base (resets + :root font/layout vars + h1-h3 face)
  // -> fonts (@font-face) -> layout (page frame) -> prose (content body) ->
  // motion (M8-05: staggered reveal + eased hover). motion.css loads LAST so its
  // `transition` on the existing hover selectors layers without !important. None
  // of fonts/layout/prose/motion declares a --color-*, so the tokens ratchet is
  // unaffected (it readdirSync-scans every non-tokens .css file).
  css: [
    '~/assets/css/tokens.css',
    '~/assets/css/base.css',
    '~/assets/css/fonts.css',
    '~/assets/css/layout.css',
    '~/assets/css/prose.css',
    '~/assets/css/motion.css',
  ],
  app: {
    head: {
      // Static only — app.head is serialized, so no functions here. The
      // function titleTemplate lives in app.vue via useHead (F5).
      htmlAttrs: { lang: 'en' },
      // Declaring rel="icon" stops the browser's default /favicon.ico probe,
      // which 404'd and failed Lighthouse `errors-in-console` (best-practices
      // 96→100 — the M2-03 gate surfaced it). SVG-only mark; public/favicon.svg.
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        // Preload the self-hosted Fraunces subset (M8-03). crossorigin is
        // REQUIRED even same-origin: fonts are fetched in CORS (anonymous) mode,
        // and a preload without it double-fetches (the Lighthouse
        // "preloaded font used" correctness point). The font IS applied to
        // headings (base.css), so this preload is not unused.
        {
          rel: 'preload',
          as: 'font',
          type: 'font/woff2',
          href: '/fonts/Fraunces-latin-opsz30.woff2',
          crossorigin: '',
        },
      ],
      meta: [
        // System-preference dark mode (no toggle): the browser chrome follows
        // the OS via matched media queries. Values mirror --color-bg.
        { name: 'theme-color', content: '#f7f5f0', media: '(prefers-color-scheme: light)' },
        { name: 'theme-color', content: '#15171b', media: '(prefers-color-scheme: dark)' },
      ],
    },
  },
  // M16-06: inline the global `css:` bundle into each prerendered document
  // instead of linking it. Without this key the build emits a single
  // render-blocking `<link rel="stylesheet" href="/_nuxt/entry.*.css">`
  // (2437 B transferred) that costs a round trip before first paint;
  // Lighthouse named it the ONLY render-blocking resource on
  // /case-studies/careerforge/, wasting 152 ms. With it, the same six
  // stylesheets ship as six inline <style> blocks in the `css:` order above
  // and `render-blocking-resources` scores 1 with an empty item set.
  //
  // Measured in-container, median of 3, zero scatter on both sides: the case
  // study moved 0.96 -> 0.97 (FCP 2104 -> 1954 ms, LCP 2404 -> 2254 ms) and
  // every other asserted page held or rose; none regressed. What matters is
  // the ADR-0016 ramp margin, and it is stated against the boundary the ramp
  // actually fires at: the reported score is clamped to two decimals, so a
  // raw weighted score below 0.955 is what reports as 0.95 and drops Fraunces
  // sitewide. Raw went 0.957500 -> 0.969000, so the distance above that
  // firing boundary grew from 0.25 to 1.4 points.
  //
  // Delivery only - no CSS rule, cascade order or rendered pixel changes.
  // Verified, not assumed: the full-page screenshot is byte-identical before
  // and after (sha256 d81429e9...), and all three inline diagrams are
  // byte-identical in the shipped document with their aria-labelledby/<title>
  // wiring and all 9 `currentColor` references intact.
  //
  // The trade is deliberate: inlining adds 1988 B gz per document rather than
  // caching one stylesheet across pages, but it removes a 2437 B request, so
  // a single-page arrival transfers 449 B LESS and one round trip fewer. The
  // repeat cost lands only on multi-page sessions, and entries here are
  // overwhelmingly single-page arrivals from a link.
  features: {
    inlineStyles: true,
  },
  compatibilityDate: '2026-07-19',
  telemetry: false,
  // Own port outside the 4300–4311 web/api/e2e range (Binnie owns :3000
  // and its neighborhood). Guarded by scripts/assert-port-free.mjs, wired into
  // the dev script — Nuxt/listhen has no strict-port option (the M0-10 finding).
  devServer: { port: 4320 },
  typescript: {
    strict: true,
  },
});
