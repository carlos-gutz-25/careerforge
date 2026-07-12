# CareerForge

A personal career-development platform, built in public: **Job Intelligence Engine** (paste a job posting → evidence-cited fit analysis across seven explainable sub-scores → honest gap classification → improvement plans and application tracking) + **Professional Portfolio** (statically generated, accessibility- and performance-budgeted case studies) + **Engineering Skill Accelerator** (real gaps from real postings → learning plans with evidence-backed mastery tracking).

**Status:** planning complete · M0 Foundation in progress. No application code yet — start with the docs.

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

## A note on ingestion

The MVP ingests **manually pasted** job-posting text only. There is no scraping or automated collection in this codebase, by design; any future collection work is gated by the legal invariants in [docs/RISKS.md](docs/RISKS.md) (L-01).
