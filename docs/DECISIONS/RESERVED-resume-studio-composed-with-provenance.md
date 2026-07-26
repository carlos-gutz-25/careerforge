# ADR-RESERVED: Resume Studio - composed-with-provenance

**Status:** Reserved (stub) · **Number:** assigned at merge order (0016+) · **Reserved:** 2026-07-26 (M5-02)
**Owning story:** M6-02 (gate) / M6-04 (service). **Relationship:** supersedes-in-part ADR-0012 (guide-only scope).

## Why this stub exists

v2 ADR numbers are assigned at merge order, not reservation order (V2-PLAN section 6), so the
number is deferred: this file reserves the decision *by name* until its owning story lands, at
which point it is renamed `00NN-resume-studio-composed-with-provenance.md` and authored in full.
Reserving it now keeps the decision named and prevents a late-invented rationale.

## What it will record

- The operator chose **LLM-drafted resume prose** over selection-only; ADR-0012's by-construction
  honesty guarantee evolves to **by-validation + human review**.
- The **deterministic claim-provenance gate** (pure module in `packages/scoring`, runs server-side
  pre-insert, any violation flags the run and writes nothing) and its laws: citation membership,
  numeric law, vocabulary law, structural provenance-class law, untrusted-text law.
- The named **residual**: semantic overstatement built only from evidenced tokens/numbers is not
  caught by deterministic checks; human review is the backstop, stated plainly.
- **Rejected-but-revisitable** alternative: selection-only prose. Also rejected: unconstrained drafting.
- Export formats/libraries and the determinism posture (`packages/resume-render`).

See docs/PLAN.md section 7 (v2 roadmap) and BACKLOG M6.
