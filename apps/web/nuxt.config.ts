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
  // must stay in lockstep with WEB_APP_ORIGIN (.env.example).
  devServer: { port: 3000 },
  runtimeConfig: {
    public: {
      // Override with NUXT_PUBLIC_API_BASE (documented in .env.example).
      apiBase: 'http://localhost:3001',
    },
  },
  typescript: {
    strict: true,
  },
});
