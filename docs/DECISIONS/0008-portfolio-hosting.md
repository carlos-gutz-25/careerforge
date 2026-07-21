# ADR-0008: Portfolio static hosting on GitHub Pages

**Status:** Accepted · **Date:** 2026-07-19

## Context

`apps/portfolio` is a Nuxt SSG site (ADR-0001) — fully static, no runtime backend — that must deploy publicly from CI on merge to `main` (M2-01). It has a hard week-9 publish deadline. The repo is public; the portfolio publishes only deliberately curated content and imports no platform packages or private data (ARCHITECTURE §2, the eslint `ANY_INTERNAL` wall). The choice of static host was open (M2-01 acceptance criteria); a **hard constraint** governs it — no secrets of any kind may enter deploy config, and introducing any host API token is a STOP-and-ask (CLAUDE.md, RISKS S-03).

## Decision

Host the portfolio on **GitHub Pages**, deployed by a GitHub Actions workflow (`.github/workflows/deploy.yml`) on push to `main`.

- **Zero user-defined secrets.** Pages deploys via the auto-provided `GITHUB_TOKEN` + OIDC (`actions/upload-pages-artifact` → `actions/deploy-pages`). No API token is ever added — this is the decisive reason, honoring the no-secrets constraint with no STOP-and-ask. Every alternative below requires a first-ever repo secret.
- **Native to the existing CI.** The deploy job reuses the established setup block (`corepack enable` → `setup-node` with `.nvmrc` → `pnpm install --frozen-lockfile`), then a single `pnpm --filter @careerforge-app/portfolio generate:pages`.
- **Base URL is env-driven, single source of truth.** A GitHub *project* site serves from a subpath (`/careerforge/`), so `NUXT_APP_BASE_URL=/careerforge/` is set in exactly one place — the `generate:pages` package.json script — which both the CI `portfolio-build` check and `deploy.yml` invoke by name, so the tested and deployed base URL cannot drift. Plain `nuxt generate` (local preview, and the future apex domain served at `/`) defaults to `/`.
- **Deploy decoupled from domain.** M2-01 ships to the default `*.github.io` URL only. The custom domain — `carlosgutz25.com` (OPEN-QUESTIONS Q2, resolved 2026-07-19) — is attached in a **separate later step** (CNAME file + DNS + repo setting, then drop the `NUXT_APP_BASE_URL` prefix): DNS propagation is not under CI control and the week-9 deadline is immovable.
- **Concurrency.** The deploy job uses a `pages` concurrency group with `cancel-in-progress: false` — two quick merges queue; a deploy is never cancelled mid-upload.

## Alternatives Considered

- **Cloudflare Pages:** excellent Nuxt/edge story and analytics, and — unlike Pages — can set custom response headers (see Consequences). Rejected for M2-01 because it requires `CLOUDFLARE_API_TOKEN` + account ID as repo secrets, the repo's first user-defined secret (a STOP-and-ask). Named successor if the header limitation forces a move.
- **Netlify:** simple static hosting, but requires `NETLIFY_AUTH_TOKEN` + site ID secrets — same STOP-and-ask.
- **Self-hosted / platform deploy:** out of scope; the platform is local-only for the first 12 weeks (PLAN §2.4). The broader platform-deployment decision is deferred to M4 (ADR-0009, reserved).

## Consequences

- **No secret to leak, rotate, or document** — the strongest privacy/security posture for a public repo.
- **Header limitation (named reopening trigger).** GitHub Pages cannot set custom response headers (`Content-Security-Policy`, `Permissions-Policy`, `X-Frame-Options`) or issue real server redirects. **If M2-03's Lighthouse/axe budgets or a security review require response headers, this decision reopens; Cloudflare Pages is the named successor.** (Whether Lighthouse's best-practices category actually scores CSP is to be verified against live Lighthouse docs at the M2-03 slice — not assumed here.)
- **Project-site subpath** until the apex domain lands; handled by the env-driven base URL above, so the cutover is a one-line change.
- **Environment protection** on the `github-pages` environment is configured by GitHub by default; the operator observes the actual deployment-branch policy when enabling Pages (source = GitHub Actions). Enabling Pages is an operator action — the agent does not change repo settings.

## Value

- **Product:** the portfolio is live and auto-deploys on merge, with a trivial custom-domain cutover.
- **Skills:** demonstrates a secretless OIDC-based CI/CD deploy and static-hosting trade-off analysis (headers, base-path, domain sequencing).
- **Employability:** a public, continuously deployed site a hiring manager can read, wired through CI the same repo demonstrates elsewhere.

## Amendment (2026-07-20) — custom-domain cutover (M2-11)

This amendment **supersedes the bullets at lines :14, :15, :16, and :29 above**,
which describe the superseded `/careerforge/` subpath-era mechanism. The original
bullets are retained as the historical record; this section states the corrected,
running reality.

- **Domain (supersedes :16).** The custom domain is **`carlosgutz.com`**, **re-decided 2026-07-20**. OPEN-QUESTIONS Q2's 2026-07-19 answer named `carlosgutz25.com`, which was **never purchased** — a factual error, not a design change.
- **No CNAME file (supersedes the "CNAME file" step in :16).** That step is wrong. GitHub docs, *Managing a custom domain for your GitHub Pages site*: "If you are publishing from a custom GitHub Actions workflow, no `CNAME` file is created, and any existing `CNAME` file is ignored and is not required." This repo publishes via `deploy.yml` + `actions/deploy-pages`; no `CNAME` file exists or is added.
- **Deploy shape (supersedes :14 / :15).** The deploy build is now plain **`generate`** (base `/`); the `generate:pages` script and its `NUXT_APP_BASE_URL=/careerforge/` prefix are **removed**. CI (`portfolio-build`) and `deploy.yml` invoke the same `generate` script, so tested and deployed output cannot drift (the single-source-of-truth property, now at base `/`).
- **Cutover executed (supersedes :29).** The "one-line change" project-site cutover is done: the site serves from the apex root `/`.
