// SPA mode (ADR-0001): a single authenticated user behind login — SSR buys
// nothing, and `ssr: false` keeps the API boundary clean: ALL data flows
// through apps/api; Nitro server routes carry no platform business logic
// (module-boundary rule, ARCHITECTURE §2). See README.md for the SPA-mode
// consequences (auth resolution, 401 handling, CSRF posture).
export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: '2026-07-15',
  telemetry: false,
  // The dev origin the API's CORS allowlist and CSRF origin check expect —
  // must stay in lockstep with WEB_APP_ORIGIN (.env.example) AND with the
  // port the preflight guards (scripts/assert-port-free.mjs, wired into the
  // dev script — Nuxt/listhen has no strict-port option, and silently
  // re-porting breaks the exact-match origin security). 4300/4301 because
  // binventory, a permanent local service, owns :3000 and its neighborhood.
  devServer: { port: 4300 },
  runtimeConfig: {
    public: {
      // Override with NUXT_PUBLIC_API_BASE (documented in .env.example).
      apiBase: 'http://localhost:4301',
    },
  },
  typescript: {
    strict: true,
  },
});
