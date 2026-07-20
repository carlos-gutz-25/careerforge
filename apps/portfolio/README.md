# apps/portfolio — public portfolio (Nuxt 4, SSG + Nuxt Content)

The public CareerForge portfolio. **Static site generation (`nuxt generate`) is
deliberate** (ADR-0001): the site itself is the product — accessibility,
performance, semantic HTML, CI/CD — and it deploys to a static host with **no
runtime backend**. Unlike `apps/web` (SPA, `ssr: false`), SSR/prerender is ON so
every page is pre-rendered to static HTML at build time.

## The module wall (ARCHITECTURE §2)

`apps/portfolio` imports **zero** platform packages and touches **no** private
data — it builds with no access to `apps/api`, the database, or `docs/profile/`.
This is eslint-enforced: `packages/config/eslint.config.js` applies the
`ANY_INTERNAL` restriction to `apps/portfolio/**`, banning every `@careerforge/*`
import except `@careerforge/config` (build tooling). Case studies publish only
deliberately curated content (later M2 stories); nothing from `docs/profile/`
ever enters this app.

## Running it

```sh
pnpm dev:portfolio      # from the repo root: this app on http://localhost:4320
pnpm generate:portfolio # static build → apps/portfolio/.output/public/
```

Port **4320** is outside the 4300–4311 web/api/e2e range (binventory, a permanent
local service, owns :3000 and its neighborhood). Port collision is a **loud
failure**, not a silent re-port: `scripts/assert-port-free.mjs` refuses to start
`nuxt dev` when :4320 is taken (Nuxt/listhen has no strict-port option — the
M0-10 finding). Change `devServer.port` (nuxt.config.ts) and the preflight
argument (package.json `dev` script) together.

## Base URL (GitHub Pages)

The site is deployed to GitHub Pages (ADR-0008). A GitHub **project** site serves
from a subpath (`/careerforge/`), so the deployed build sets Nuxt's base URL via
the native `NUXT_APP_BASE_URL` env var. This lives in exactly one place — the
**`generate:pages`** script (`NUXT_APP_BASE_URL=/careerforge/ nuxt generate`) —
which both the CI `portfolio-build` check and the deploy workflow invoke by name,
so the tested subpath and the deployed subpath cannot drift. Plain `nuxt
generate` (local preview, and the future apex domain served at `/`) defaults to
`/`. The custom-domain cutover is a one-line change (drop the env prefix).

## Testing & typecheck

- `pnpm test` (root) runs this workspace's vitest project in the `nuxt`
  environment (`@nuxt/test-utils`). `tests/setup/prepare-nuxt.mjs` writes
  `.nuxt/` once before tests so a fresh clone resolves `tsconfig.json`.
- `pnpm typecheck` runs `nuxt typecheck` (vue-tsc). `tsconfig.json` extends the
  **generated** `.nuxt/tsconfig.json` (Nuxt convention — a documented deviation
  from `@careerforge/config/tsconfig.base.json`).
