# ADR-0020: Requirement assessment - category-aware evaluators + evidence-status taxonomy

**Status:** Accepted · **Date:** 2026-07-29

## Context

M12-02 opens the v2.1 correctness arc, authored from the M9-01 dogfooding findings. Three defects in
the deterministic gap classifier (`packages/scoring/classify-gaps.ts`), all verified firsthand against
main before this decision:

- **F1 - absence read as a gap.** The classifier's final fall-through returned `genuine_gap` whenever
  no named-skill evidence linked a requirement. "No evidence found" and "evidence confirms unmet" were
  indistinguishable, so the engine converted the operator's own modesty (a skill not listed) into a
  confirmed gap and generated coaching noise.
- **F2 - category blindness.** `classifyRequirement` never read `requirement.category`. Seniority,
  compensation, location, and administrative requirements were laddered through *skill* evidence and
  surfaced as skill gaps (the dogfood counts: seniority 4, comp 1, location 1 inside 35 genuine_gap).
- **F3 - a threshold that never propagated.** The seniority dimension computes a real years comparison
  (`demandedYears` vs `professionalSpanYears`) but the result stayed local to the dimension and never
  reached the classifier, so one requirement could score *satisfied* in the fit dimension and classify
  *genuine_gap* in gaps at the same time.

Like ADR-0014, this is not a schema-only story structurally identical to prior precedent: it **narrows
a shipped classification's semantics** (`genuine_gap` stops meaning "no evidence" and starts requiring
a positive signal) and introduces a category-routing model across the scoring engine and every gap
consumer. That is a "new major technical choice" per CLAUDE.md, hence a new ADR. Design authority is
the arc package's Carlos-ratified decisions (D-1..D-8).

## Decision

**Extend the enum in place, not a parallel record (D-1).** `GAP_CLASSIFICATIONS` grows from five to
eight, appending three EVIDENCE-STATUS classes after the frozen five: `unknown`, `satisfied_fact`,
`not_applicable`. The existing five keep their exact meaning (additive-only law). Two additive,
nullable columns land on `gaps`: `evaluator` (which deterministic evaluator produced the class) and
`confidence`. One source of truth, no second record. The parallel `RequirementAssessment` record
(a separate table carrying its own verdict) is **rejected-with-revisit**: the reopen trigger is a
requirement ever needing multiple simultaneous verdicts, or the evaluator set outgrowing a single row.
Guard against "half-baked": additive-only semantics, and exhaustive `Record<GapClassification, _>`
typing wherever a map over classifications exists so the compiler forces every consumer to handle the
new classes (the silent object-literal sites that the compiler cannot force are pinned by tests -
the arc R-1 coverage risk).

**Category routing before the skill ladder (F2).** `classifyRequirement` routes on
`requirement.category` first:

- `seniority` -> the shared threshold evaluator (below).
- `comp` / `location` -> `not_applicable` (evaluator `dimension_delegation`): assessed by their own
  fit dimension and the search criteria, never a skill gap, never entering learning surfaces.
- `other` matching an administrative phrase list -> `unknown` (evaluator `administrative_pattern`).
- `language` / `framework` / `domain` / non-administrative `other` -> the existing M1-11 skill ladder
  (evaluator `skill_evidence`), unchanged through its first four rungs.

**The shared seniority threshold evaluator (F3).** `demandedYears` and `professionalSpanYears` move to
`packages/scoring/evaluators/seniority-threshold.ts`, and both the fit dimension and the classifier
consume the same `evaluateSeniorityThreshold`. A seniority requirement now classifies:
demanded years met -> `satisfied_fact` (confidence `high`, numeric rationale); short -> `genuine_gap`
(confidence `high`, numeric rationale); no years figure stated -> `unknown`. A requirement can no
longer score satisfied and classify genuine_gap.

**The unknown-vs-genuine_gap law (F1).** `genuine_gap` now requires a POSITIVE signal: a learning-level
skill match (D11 - "refresh" would claim past competence that never existed, now an explicit rung), a
short numeric threshold, or an operator override. With no positive signal the skill-ladder fall-through
is `unknown` (insufficient evidence), never `genuine_gap`. This narrows ADR-family D10 ("adjacent-only
evidence is a genuine_gap"): adjacent-only evidence with no named skill is now `unknown`, with the
adjacent evidence surfaced in the rationale so the operator can confirm it (add a skill) or dismiss it.

**Administrative patterns are plain code (D-6).** The administrative phrase list (work authorization,
visa/sponsorship, citizenship, security clearance, background check, drug screening, and similar - the
authoritative set is the `ADMINISTRATIVE_PATTERNS` const in `classify-gaps.ts`, deliberately not
re-enumerated here so the doc cannot drift from the mutable list) is matched at the token level (never
substring - "data visualization" does not fire "visa"). It is updatable with no prompt-version
ceremony or live-leg spend. An
`administrative` *extraction* category is deferred to the atomic-extraction arc, which already owes a
prompt-version bump.

**Evidence-status classes are never LLM-drafted (R-2).** A core primitive
`GAP_EVIDENCE_STATUS_CLASSIFICATIONS` + `isEvidenceStatusClassification` gates all four drafting payload
builders (improvement / learning / interview / gameplan): the three classes never reach an LLM prompt,
and each builder keeps its existing treatment of the five skill classes. The prompt registry is
untouched - zero prompt text changes, so no new prompt version and no live adversarial leg.

**Market-signal cohort (D-5).** `satisfied_fact` / `not_applicable` are non-actionable (they land in
the existing covered/low-priority noAction reason). `unknown` gets its own honest surfacing: a per-group
`needsInputCount`, and a new noAction reason `needs_input` so an all-unknown group is never mislabeled
"covered." `unknown` never enters the Build bucket. `MARKET_SIGNAL_SCORER_VERSION` bumps 1 -> 2 (the
reproducibility anchor; the classifier itself has no version constant - gap rows are per-report
snapshots).

**Evaluator/confidence are immutable engine metadata.** They describe `engine_classification`, not the
effective (possibly overridden) `classification`. An override changes `classification` and sets
`userOverridden`; it does not touch `evaluator`/`confidence`, so the UI can honestly show "engine said
X via seniority_threshold; you overrode to Y." `manual_review` is reserved in `GAP_EVALUATORS` for a
future story that records an override's own evaluator; it ships now to avoid a second CHECK migration.

**D-8 (honest strength for threshold evidence) is DEFERRED, not done.** The plan proposed flipping the
seniority years-met evidence link from `adjacent` to `direct`. This is **infeasible** in M12-02: the
evidence-strength law (`EVIDENCE_STRENGTHS`, enforced by `fitReportDataSchema`'s "direct evidence
requires a named profile skill" refine) reserves `direct` for a named profile skill, and the threshold
proof is experience-anchored (`profileExperienceId`, no `profileSkillId`). Giving a deterministic proof
its own strong slot needs an evidence-model change, which is exactly the parked **skill-model split**
that the arc's own D-8 resolution says the broader answer folds into. M12-02 keeps the strength
`adjacent`; F3's real win (the classifier emits `satisfied_fact` from the same threshold) is unaffected.
This deferral was surfaced to Carlos when the schema refine rejected the flip.

## Consequences - named residuals and second-order effects

- **(a) Snapshot law, no backfill.** Migration 0023 expands the `gaps.classification` CHECK to eight
  values (all five old values remain, no orphaning) and adds the two nullable columns. Stored
  classifications from old runs are point-in-time snapshots of the scorer that produced them and are
  left untouched; `evaluator`/`confidence` are NULL on pre-M12-02 rows (rendered as "engine (pre-M12)").
  Re-scoring an old posting produces the new taxonomy.
- **(b) genuine_gap population shrinks - intended.** Fewer requirements classify as genuine_gap (the F1
  narrowing), and Build in the market signal narrows to confirmed gaps. This is the honesty fix, not a
  regression: "needs your input" and "not a skill gap" are now distinct from "confirmed gap."
- **(c) Downstream suppression.** satisfied_fact / not_applicable / unknown are excluded from
  learning-plan candidate sets, the four LLM payloads, and (for the first two) the actionable market
  buckets; `unknown` carries a deterministic, templated resolution affordance in the Gaps UI (add a
  skill, attach mastery evidence, or - in M12-03 - declare a durable fact) plus a deep link, and the
  existing audited override path. No new resolution machinery (the evidence-interview loop stays v2.2).
- **(d) Refuted external premises, recorded so they are not re-litigated.** "No numeric threshold
  comparison exists" is FALSE (it exists in the seniority dimension; the defect was propagation, F3).
  "The resume engine can only reorder" conflates the v1 tailoring guide (honestly labeled
  non-submittable) with resume-compose (which drafts prose under the claim-provenance gate). "Personal
  projects are ineligible for the composed resume" is FALSE (eligible as project/summary claims; only
  employment-claim laundering is barred - the honesty model working, kept).
- **(e) Durable-facts hook.** `durable_profile_fact` ships in `GAP_EVALUATORS` unused; M12-03 wires the
  facts evaluator so administrative requirements resolve against declared facts instead of `unknown`.

## Alternatives considered

- **Parallel `RequirementAssessment` record** - rejected-with-revisit (a second source of truth; reopen
  trigger recorded above).
- **An `administrative` extraction category** - deferred to the atomic-extraction arc (a prompt-version
  bump this story deliberately avoids); pattern-matching in plain code carries v2.1.
- **Flipping the threshold evidence to `direct`** - deferred (blocked by the evidence-strength law;
  folds into the parked skill-model split, consequence (D-8) above).
- **Reusing `GAP_DISCLOSURE_REQUIRED_CLASSIFICATIONS` as the drafting filter** - rejected (conflates
  interview-disclosure obligation with drafting eligibility; a distinct `isEvidenceStatusClassification`
  primitive keeps the two concepts independent even though their members coincide today).
