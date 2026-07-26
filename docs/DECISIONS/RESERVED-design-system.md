# ADR-RESERVED: Design system - two identities, one grammar

**Status:** Reserved (stub) · **Number:** assigned at merge order (0016+) · **Reserved:** 2026-07-26 (M5-02)
**Owning story:** M8-01.

## Why this stub exists

v2 ADR numbers are assigned at merge order (V2-PLAN section 6). This file reserves the decision by
name until M8-01 lands, then it is renamed `00NN-design-system.md` and authored in full.

## What it will record

- **Two visual identities, one grammar, no shared package.** Each app owns its own `tokens.css` in
  the strict `light-dark()` grammar and its own copy of the contrast gate. A shared
  `@careerforge/design` package is a **v2.1 reopening trigger** (third frontend, or measured drift pain).
- Portfolio identity: **"Provenance Ledger"** (Fraunces variable self-hosted, verification-green accent).
- Platform identity: **"Dusk Console"** (IBM Plex Sans + JetBrains Mono, dark-first amber accent,
  a full semantic status family replacing the 22 raw hexes).
- Font self-hosting policy (subset budget, metric-adjusted fallback, preload, abort-to-system ramp
  with budgets never lowered) and the PAIRS contrast thresholds.

See docs/PLAN.md section 7 (v2 roadmap) and BACKLOG M8.
