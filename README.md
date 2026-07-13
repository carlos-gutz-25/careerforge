# CareerForge

A personal career-development platform, built in public: **Job Intelligence Engine** (paste a job posting → evidence-cited fit analysis across seven explainable sub-scores → honest gap classification → improvement plans and application tracking) + **Professional Portfolio** (statically generated, accessibility- and performance-budgeted case studies) + **Engineering Skill Accelerator** (real gaps from real postings → learning plans with evidence-backed mastery tracking).

**Status:** M0 Foundation in progress — local Postgres, validated env, and the Fastify API skeleton are up. Start with the docs.

## The rule this repo is built on: honesty is a feature

Fit scores are deterministic and explainable; every claim cites verbatim evidence from both the job posting and the profile; the LLM extracts but never scores; nothing is ever fabricated, inflated, or auto-sent. See [docs/DECISIONS/0005](docs/DECISIONS/0005-llm-integration-pattern.md) and [0006](docs/DECISIONS/0006-prompt-injection-defense.md).

## Public repo, private data

This repository is public, but **real career data never enters it**:

- `docs/profile/` holds the real profile (resume, projects, job criteria) — **gitignored**, local only, backed by pre-commit and CI guards.
- [`docs/profile.example/`](docs/profile.example/) is a fully fictional profile with the same structure; all tests, fixtures, demos, and screenshots use it exclusively.
- Secrets live in `.env` (gitignored); `.env.example` documents variable names only.
- [gitleaks](https://github.com/gitleaks/gitleaks) runs as a pre-commit hook and in CI.

One-time setup after cloning:

```sh
brew install gitleaks
git config core.hooksPath .githooks
```

## Documentation

| Document | Contents |
| --- | --- |
| [docs/PLAN.md](docs/PLAN.md) | Product vision, MVP definitions, 12-week roadmap |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, monorepo layout, data model (ERD), API surface |
| [docs/DECISIONS/](docs/DECISIONS/) | ADRs — every major choice, with its product/skill/employability rationale |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Prioritized stories with acceptance criteria, per milestone |
| [docs/RISKS.md](docs/RISKS.md) | Security, privacy, legal, and scope risks with enforced mitigations |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | Decision log for open/resolved product questions |

## Stack (per ADRs)

TypeScript everywhere · Nuxt 4 (Vue 3) frontends · Fastify API · PostgreSQL 16 + Drizzle · pnpm workspaces · Vitest · Docker for local dev · GitHub Actions CI · Anthropic API behind a swappable provider interface.

## Repository layout

pnpm workspaces, no build orchestrator — root scripts run everything via `pnpm -r` ([ADR-0004](docs/DECISIONS/0004-pnpm-workspaces-monorepo.md) has the criteria for ever adding one).

```text
apps/
├── api/        Fastify backend (routes → services → repositories)
├── web/        Nuxt platform UI — talks only to apps/api
└── portfolio/  Nuxt SSG portfolio — never imports platform packages
packages/
├── config/     Shared tsconfig, eslint, and vitest config consumed by every workspace
├── core/       Domain types, zod schemas, shared constants — zero internal deps
├── db/         Drizzle schema, migrations, repositories — the only module with SQL
├── llm/        LLM provider interface, versioned prompts — the only module with LLM SDKs
└── scoring/    Deterministic fit-scoring engine — pure functions, never imports llm
```

`apps/api` carries the Fastify skeleton: `/health`, pino request-id logging, a centralized `{ error: { code, message } }` handler (the canonical error-body contract: stacks never appear in any response body; dev 500s may carry `error.message`, production 500s are fully generic, and intentional 4xx messages pass through in both modes), and the routes → services → repositories reference slice (in-memory repository until packages/db lands in M0-06). The Nuxt apps are still placeholders and land with each app's first story. Module boundaries ([ARCHITECTURE §2](docs/ARCHITECTURE.md#2-monorepo-layout)) are enforced twice: structurally (pnpm's strict isolation — a workspace can only import what its `package.json` declares, so `scoring` cannot resolve `llm` at all) and by lint (`no-restricted-imports` blocks per directory in the shared eslint config). If those outgrow their usefulness, dependency-cruiser in CI is the designated escalation.

Two deliberate tooling deviations: import-x's resolution-dependent lint rules (`no-unresolved`, `namespace`, …) are off — tsc already owns module resolution with full workspace/`exports` awareness, and a second resolver would only duplicate it, less accurately. And `@careerforge/config` is exempt from the "no internal packages" walls: it is build tooling consumed by every workspace, not a platform package.

## Development

One-time local setup. Local Postgres requires a container runtime — Docker Desktop, OrbStack, and colima all work; the compose file doesn't care which. Note that VM-based runtimes such as colima must be started first (`colima start`), or every `docker` command fails with a daemon-connection error.

```sh
cp .env.example .env   # then fill in values; every variable is documented there
docker compose up -d   # Postgres 16 on a persistent named volume (pgdata)
```

```sh
pnpm install        # Node ≥ 24, pnpm ≥ 11
pnpm dev            # boots apps/api (env is zod-validated first — fails fast if .env is wrong)
pnpm typecheck      # tsc --noEmit in every workspace
pnpm lint           # eslint + prettier --check across the repo
pnpm test           # one vitest run covering every workspace's suite
pnpm format         # prettier --write
```

The env schema (`apps/api/src/env.ts`) is the single source of truth: boot fails fast naming any missing/invalid variable, and a test asserts every schema key is documented in `.env.example`.

Internal packages are consumed as TypeScript source (`exports` → `./src/index.ts`) — no build step, by design. The same convention extends to execution: Node runs TypeScript directly via native type stripping (no tsx/ts-node, no compile step). Two consequences, both deliberate: imports of local TS files use explicit `.ts` extensions (enabled by `allowImportingTsExtensions`, safe under `noEmit`), and directly-executed code must stay type-stripping-compatible — no enums, namespaces, or parameter properties.

## A note on ingestion

The MVP ingests **manually pasted** job-posting text only. There is no scraping or automated collection in this codebase, by design; any future collection work is gated by the legal invariants in [docs/RISKS.md](docs/RISKS.md) (L-01).
