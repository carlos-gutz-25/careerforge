# ADR-0004: Plain pnpm Workspaces (No Build Orchestrator Yet)

**Status:** Proposed · **Date:** 2026-07-12

## Context

The project is a pnpm-workspaces monorepo by convention (CLAUDE.md): 3 apps, 5 packages, one developer. The question is whether to add a build orchestrator (Turborepo, Nx) from day one.

## Decision

Plain pnpm workspaces. Task running via root `package.json` scripts using `pnpm -r --filter` and `--parallel`; shared config lives in `packages/config`.

**Explicit criteria for adopting Turborepo later** (revisit when any one is true):

1. CI wall-clock time regularly exceeds ~10 minutes and per-package caching would demonstrably cut it.
2. The workspace grows past ~8 packages with a non-trivial dependency graph.
3. Incremental local builds become a daily friction (measured, not felt).

If adopted, Turborepo over Nx: thinner, closer to plain scripts, easier to remove.

## Alternatives Considered

- **Turborepo from day one:** popular and resume-visible, but at this scale it's configuration for a problem we don't have; caching a 30-second CI run is theater.
- **Nx:** powerful generators and graph tooling, but a heavy framework with its own idioms; wrong size for a solo modular monolith.
- **Polyrepo:** rejected outright — shared zod schemas/types across api/web/packages are the backbone of end-to-end type safety, and the public-evidence story is strongest as one coherent repo.

## Consequences

- Zero orchestrator config to maintain; `pnpm test` at the root just works; newcomers (i.e., hiring managers reading the repo) see standard tooling.
- CI runs everything on every push initially — acceptable at this scale, and the adoption criteria above define exactly when that stops being acceptable.
- This ADR itself documents the re-evaluation trigger, so the decision is cheap to revisit honestly.

## Value

- **Product:** less tooling surface, faster start on actual features.
- **Skills:** right-sizing infrastructure is a senior skill; the documented adoption criteria demonstrate it better than premature adoption would.
- **Employability:** an interviewer asking "why no Turborepo?" gets a written, criteria-based answer in the repo — that conversation is worth more than the tool badge.
