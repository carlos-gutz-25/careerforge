# ADR-0010: Case-study honesty schema and gate

**Status:** Accepted · **Date:** 2026-07-21

## Context

M2-04 delivers the case-study template + honesty labeling for `apps/portfolio` (a Nuxt SSG site,
ADR-0001). The acceptance criteria (docs/BACKLOG.md) require a schema that **enforces** seven fixed
sections (problem, constraints, architecture, tradeoffs, testing, results, what-I'd-change), a
**required** provenance label (professional / personal / personal, AI-assisted), and results that
**only state substantiated metrics** (sourced from `docs/profile/projects.md` or the repo itself).
"Honesty is a feature" (PLAN.md:19); fabricated or inflated claims are the product's core failure
mode (RISKS H-01), and employer-proprietary detail in public case studies is a standing risk
(RISKS L-02).

**Probe finding (source-verified) — why the schema alone cannot enforce anything.** `@nuxt/content`
3.15.0 performs **no** schema validation at ingest: a `defineCollection` zod schema is converted to
JSON Schema for column typing only, the parse path never calls `safeParse`, a missing required field
inserts NULL/default, and an out-of-enum value is inserted verbatim. Consequence: `nuxt generate`
builds **green** on schema-violating content. The `content.config.ts` schema is typing +
documentation; the enforcement must live somewhere that actually runs.

## Decision

Enforce the honesty schema with a **standalone, deterministic, build-time gate** —
`apps/portfolio/scripts/validate-case-studies.mjs` — and **fold it into the existing required
`portfolio-build` check** (per ADR-0009; no new required check, no ruleset change, empty bypass
untouched). This is minted as a **new ADR, not an ADR-0006 amendment** (see Alternatives).

- **The schema enforces the honesty rules — it is not advisory.** Seven sections as a closed set in
  canonical order (R6), a required provenance token from a fixed set (R2), and — the headline rule —
  **Results sourcing (R8):** any Results block stating a number must carry a citation, and every
  citation must parse **and resolve** (repo path exists / git SHA resolves / milestone + risk id
  substring-verified / `docs/profile/projects.md` accepted as an opaque token). Free-prose
  "evidence" fails by grammar — widening it to admit prose would be honesty theater.
- **Provenance is required and displayed.** The template renders the label directly under the `<h1>`;
  a token that somehow slips the gate renders visibly wrong (`?? token` passthrough), never silently
  absent. `sensitivityReviewed` (a date recording a human employer-sensitivity review, RISKS L-02) is
  **required** when provenance is `professional` (R3).
- **Deterministic, browser-free, zero-dependency, no LLM.** The gate is pure node string work — the
  same class as `assert-prerender.mjs`. No LLM touches any part of it (contrast ADR-0006, which
  governs LLM output).
- **Reuse, not duplication of intent.** The body-h1 detector is shared with the content-convention
  gate via `scripts/lib/markdown-scan.mjs` (one implementation of "what is a body h1"), and the R4
  rule re-runs it inside `portfolio-build` (the vitest content-convention gate lives only in the
  `test` job).

## Alternatives Considered

- **Amend ADR-0006 instead of a new ADR** — rejected. ADR-0006 is prompt-injection defense for
  **attacker-controlled** platform input; M2-04 governs **trusted, repo-authored** portfolio content.
  Different threat model (self-honesty / fabrication drift, not injection), different app
  (`apps/portfolio` vs the platform), different mechanism (a build-time content gate vs a runtime
  quote verifier). M2-04 **inherits the lineage** of ADR-0006 layer 4 (deterministic evidence
  verification) and cites it, but the decision is its own.
- **Rely on `@nuxt/content`'s schema at ingest** — rejected: the probe proves it validates nothing;
  the build is green on violations.
- **Optional provenance label / any-prose results** — rejected as honesty theater: an optional label
  and unsourced numbers defeat the acceptance criteria's purpose.
- **Extend the R8 digit rule to all prose (not just Results)** — rejected: it manufactures filler
  citations on non-claim prose; Results is where numbers make claims.

## Consequences

- **Coverage boundary (the gate proves shape and resolution, not truth).** It cannot verify a claim
  is true, that a cited file supports the number, or that `docs/profile/projects.md` contains the
  metric — that leg is **local human review before merge** (P-01 keeps `docs/profile/` out of the
  tree and CI forever, so the projects.md citation is an opaque, always-accepted token). Story/risk
  citations are verified-lite (substring of BACKLOG/RISKS). **Known gap (parked — owned by the next
  R8 touch / M2-07 citation cleanup):** the milestone grammar admits a compound slash-form
  (`M2-01/02/03`) that verified-lite cannot confirm — it substring-matches the *whole* token, and a
  compound is rarely literally present even when each component is. Such a citation fails R8 (surfaced
  by M2-04's local acceptance run, where the real draft's `[M2-01/02/03; …]` failed); the strict
  resolution is to cite components individually (`M2-01; M2-02; M2-03`) or a SHA. The grammar was
  deliberately **not** widened to split-and-verify components — that is an ask-first change requiring
  its own planted-FAIL. Section **semantics** are unverified (headings exist, are ordered, and are
  non-empty; whether "Tradeoffs" discusses tradeoffs is human review). `sensitivityReviewed` records
  that a human act occurred; it is format-checked only. Prose outside Results is deliberately not
  citation-gated. Word-numbers ("three gates") are an accepted, stated false negative (visible to
  human review).
- **Two required checks guard two things.** The vitest suite guards the validator's **logic** in the
  `test` job; the script guards **content** in `portfolio-build`. Either class blocks merge.
- **SHA citations need full history.** `portfolio-build` checks out `fetch-depth: 0`; the validator's
  shallow-checkout guard exits 2 (cannot-run, never a pass) if that is ever dropped while SHA
  citations exist — accidental removal goes loudly red.
- **Publication owes a citation cleanup.** The real CareerForge draft's Results use prose citations
  ("verified session evidence") that fail R8 by design; M2-07 must conform them to the grammar before
  publishing. That is the feature working, not a defect.

## Value

- **Product:** a case study cannot ship without its provenance label, its seven sections, or a source
  for every number it claims — the honesty differentiator is enforced by the build, not by discipline.
- **Skills:** a deterministic content-validation gate (frontmatter, section grammar, citation
  resolution against a live repo) wired secretlessly into CI on the shipped artifact.
- **Employability:** the public repo demonstrates honesty-as-a-feature mechanically — the same trait
  the portfolio's case studies claim, proven by the gate that guards them.
