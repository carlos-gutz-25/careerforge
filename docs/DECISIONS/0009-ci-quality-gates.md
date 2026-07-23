# ADR-0009: CI quality gates for the portfolio

**Status:** Accepted · **Date:** 2026-07-21

## Context

`apps/portfolio` is a Nuxt SSG site (ADR-0001) deployed to GitHub Pages from CI on merge to `main`
(ADR-0008). M2-03's acceptance criteria (docs/BACKLOG.md) require, on every PR: Lighthouse budgets
(performance ≥ 95, accessibility = 100, best-practices ≥ 95, SEO ≥ 95 on key pages), axe automated
checks with zero violations, and an internal link check — **a failing budget blocks merge**. The
repo is public; `main` is enforced-immutable with an **empty** ruleset bypass list; adding a repo
secret or a ruleset change is friction to be avoided.

M2-11 shipped an *unstyled* live site because a base-prefix build referenced `/careerforge/_nuxt/*`
assets that 404'd at the apex root — a class the existing `assert-prerender.mjs` (structural HTML
only, parses no href/src) was blind to. M2-03 is where that class becomes gated.

## Decision

Add three quality gates and **fold them into the existing required `portfolio-build` check**:

- **Fold, don't add a new required check.** A new required check would need an operator edit to the
  `main` ruleset (empty bypass), and re-enters the class M2-02 caught (a ci.yml comment advertising a
  blocking status the check lacks). `portfolio-build` already runs on every PR (`pull_request:` with
  no paths filter), so folding blocks merge with **zero ruleset change**. Honest cost: every PR —
  including prose-only ledger PRs — now pays Chrome + LHCI + axe + linkinator in series (~3–5 min).
- **Full axe-core** (`@axe-core/playwright`), not Lighthouse's embedded a11y subset. The subset omits
  rules axe ships (e.g. `scrollable-region-focusable`, `region`; Lighthouse a11y is 63 audits — R-1),
  so only the full engine honours the BACKLOG wording "axe … zero violations".
- **Scope `/` (home) only** — the single content page today. Lighthouse asserts via `assertMatrix`
  on `/index.html` (the 200.html/404.html SPA fallbacks are audited but not asserted); axe and the
  link check crawl from `/`. Extend the URL set when a second page lands (S3-2).
- **Pinned Playwright chromium**, shared by Lighthouse and axe via `CHROME_PATH`. A pinned browser
  gives reproducible scores; the runner's rolling system Chrome would drift the budgets. The browser
  is installed via `apps/web`'s playwright and resolved via `apps/portfolio`'s `playwright-core`
  (both pinned `^1.61.1`).
- **Internal-only link check** (linkinator). External links are skipped — third-party flakiness must
  never block a merge.
- **Audit the SHIPPED build** (`generate` → `.output/public`, base `/`) — byte-identical to what
  `deploy.yml` publishes (H-2). Served over http on localhost.

## Alternatives Considered

- **A separate required `lighthouse`/`quality` check** — rejected: needs a ruleset edit on an
  enforced-immutable `main`, and a required check that never reports on docs-only PRs would deadlock
  class-(b) ledger merges.
- **Lighthouse's embedded axe subset instead of full axe-core** — rejected: narrower than full axe
  (R-1); running it under the BACKLOG's "axe zero violations" wording would claim coverage it does
  not deliver.
- **Runner's system Chrome for Lighthouse** — rejected: version drift makes scores non-reproducible.

## Consequences

- **Measured findings (slices 1–3, observed run output):**
  - **R-2:** best-practices applicable denominator = **27**; ≥ 95 leaves ~a 2-audit cushion.
  - **R-3:** `is-on-https` **passes** on `http://localhost:<port>`, so best-practices is not capped
    by it. CI audits the **localhost artifact**, not the HTTP-only production origin (Enforce HTTPS
    is operator-owned and OPEN).
  - **R-4:** ship **no** `robots.txt` and **no** `sitemap.xml` — Lighthouse SEO scores robots.txt
    *validity* (not-applicable when absent) and has no sitemap audit; SEO = 100 with neither file.
  - **A2a:** every response-header audit in best-practices is weight-0, so ADR-0008's "GitHub Pages
    cannot set custom response headers" limitation touches only unweighted audits — **it does not
    reopen the host decision.**
  - **link-check scope:** its *unique* coverage is the asset-**path** class (M2-11). `nuxt generate`
    already blocks dead page-anchors (Nitro prerender crawl) and missing component assets (Vite
    resolution); link-check adds the case both pass — assets that exist but are referenced at a 404
    path.
- **Supply chain:** linkinator is pinned to `^7.6.1` (an established release), not the same-day
  `8.0.0`; no minimum-release-age bypass was added.
- **NO_FCP (OPEN-until-CI-observed):** a Lighthouse `NO_FCP` headless-paint error was seen *locally*
  from accumulated Chrome instances on a long-lived session; it cleared on a fresh state. No
  speculative retry is added — a retry that re-ran on an *assertion* failure would mask a real budget
  regression. If NO_FCP appears in CI, a follow-up adds a retry scoped ONLY to the
  `NO_FCP`/`ERRORED_DOCUMENT_REQUEST` runtime error.

## Value

- **Product:** the live site cannot regress performance, accessibility, SEO, best-practices, or an
  internal asset path without blocking the merge.
- **Skills:** LHCI category budgets, full axe-core, and a link check wired secretlessly through CI on
  the shipped artifact, with reproducible scores.
- **Employability:** a continuously quality-gated public site, and a documented gate-design trail
  (coverage boundaries, what each gate cannot see).

## Amendment (M2-09, 2026-07-23): OpenGraph gating + live-URL verification posture

M2-09 adds the OpenGraph/Twitter/canonical head to every page and extends the two structural gates
to assert it. This amendment records the resulting gate surface and the deliberate posture on
live-URL auditing; it supersedes nothing above (the M2-03 record stands as history).

- **OG/canonical is now gated in both structural gates.** `assert-prerender.mjs` (home/about/resume)
  asserts `og:title` MIRRORS the exact `<title>`, plus `og:description`/`og:type=website`/
  `og:site_name`/`twitter:card=summary` and that `og:url` **and** the canonical `<link>` equal the
  page's own served URL (absolute, trailing-slash normalized, derived from the generated file path).
  `assert-provenance.mjs` asserts the same og:url/canonical correctness for each case study plus
  `og:type` **exactly** `article`. Three planted-FAILs prove the new legs (top-page og:url
  correctness, case-study og:url correctness, case-study missing `og:type`) — a presence-only plant
  would leave the og:url correctness regex unproven. The apex origin is hardcoded in three files
  (`app/composables/useSeo.ts`, `assert-prerender.mjs`, `assert-provenance.mjs`) with a breadcrumb in
  each; a domain change moves all three together (ADR-0008 / M2-11 precedent).

- **Live-URL Lighthouse/axe is a record-and-sanity-check, NOT a hard gate.** The local
  `staticDistDir` build (`generate` → `.output/public`, byte-identical to `deploy.yml`) remains the
  **sole regression gate**. M2-09's production-URL run against `carlosgutz.com` is recorded once, and:
  live **accessibility = 100** and **SEO = 100** MUST hold (both are network-insensitive, and the
  live run is the first to confirm real HTTPS that the localhost artifact could not — R-3). A live
  **performance or best-practices** dip below the CI budget is **documented with the observed score,
  NOT milestone-failing**, provided the local budgets are green (network/CDN variance is not a code
  regression). No live-URL check is added to CI — it would couple merges to third-party network state.
