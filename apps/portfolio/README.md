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

## Base URL (custom domain, apex root)

The site is deployed to GitHub Pages (ADR-0008) and served from the **custom
domain `carlosgutz.com` at the apex root `/`** (ADR-0008 amended 2026-07-20,
M2-11). The deploy build is plain **`generate`** (base `/`) — the same script the
CI `portfolio-build` check invokes, so the tested and deployed output cannot
drift. The former `/careerforge/` project-site subpath (and its `generate:pages`
script) is gone. No `CNAME` file is needed: publishing via a custom GitHub
Actions workflow ignores and does not require one (GitHub docs).

## Testing & typecheck

- `pnpm test` (root) runs this workspace's vitest project in the `nuxt`
  environment (`@nuxt/test-utils`). `tests/setup/prepare-nuxt.mjs` writes
  `.nuxt/` once before tests so a fresh clone resolves `tsconfig.json`.
- `pnpm typecheck` runs `nuxt typecheck` (vue-tsc). `tsconfig.json` extends the
  **generated** `.nuxt/tsconfig.json` (Nuxt convention — a documented deviation
  from `@careerforge/config/tsconfig.base.json`).

## Design system & accessibility (M2-02)

**Design tokens** live in exactly one file — `app/assets/css/tokens.css` — the
machine-parsed source of truth. Authoring contract (enforced by
`tests/tokens-contrast.test.ts`): custom properties only, one per line; every
`--color-*` value is a bare `#hex` or `light-dark(#light, #dark)` — no `var()`
composition, no other color function. `base.css` (and any future stylesheet)
**consumes** tokens and must never declare a `--color-*`; a cross-file ratchet
FAILs if one appears outside `tokens.css`. `theme-color` meta values are checked
against `--color-bg` so browser chrome can't drift from the palette.

**Dark mode is system-preference only** — no toggle, no JavaScript, no storage
(operator decision, M2-02). Every color token is a `light-dark(light, dark)` pair
with `color-scheme: light dark` on `:root`, so a forgotten dark override is
unrepresentable. Every pair is asserted AA (≥4.5:1 text, ≥3:1 UI/focus) in BOTH
modes.

**Accessibility conventions:**

- **The template owns the single `<h1>`.** Content bodies start at `<h2>` (`## `).
  A content-convention gate FAILs on any body-level h1, ATX or setext.
- **Landmarks** live in `app/layouts/default.vue`: skip link (first focusable) →
  `<header>` (site name is a **link**, not a heading) → `<main id="main"
  tabindex="-1">` → `<footer>`, plus `<NuxtRouteAnnouncer>`.
- **Skip-link target contract:** the skip link is `<a href="#main">`, targeting
  the `id` the single `<main>` carries. Its focus ring uses `--color-skip-fg`
  (its own inverted surface), not the page `--color-focus` (**surface rule** —
  the page ring would be sub-3:1 on the skip surface in dark mode).
- **Heading anchors:** Nuxt Content wraps h2–h4 text in a same-page link; these
  are styled as typography (`color: inherit; text-decoration: none`) while
  keeping the visible keyboard focus ring.
- **Reduced motion** is honored globally (`prefers-reduced-motion: reduce` kills
  animation/transition and smooth scroll).

**Prerender gate:** the duplicate-h1 defect and the `lang`/`title` head exist
only in `nuxt generate` output (in unit tests `page` is null and ContentRenderer
is off). `scripts/assert-prerender.mjs` asserts one `<h1>`, `lang="en"`, exact
`<title>CareerForge</title>`, one `<main id="main">`, and skip-link-before-header
against real generate output; CI (`portfolio-build`) runs it after `generate`.
It is structural HTML only — axe/Lighthouse budgets are M2-03.
