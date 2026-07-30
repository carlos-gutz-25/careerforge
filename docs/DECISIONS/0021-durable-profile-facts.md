# ADR-0021: Durable profile facts - informative, never a filter

**Status:** Accepted · **Date:** 2026-07-29

## Context

M12-03 continues the v2.1 correctness arc, addressing dogfood finding **F4**: CareerForge had no
concept of a durable fact ABOUT the candidate (work authorization, visa-sponsorship need, location
and remote preference, security clearance, availability). Administrative posting requirements
therefore laddered through *skill* evidence and surfaced as coaching noise. M12-02 (ADR-0020) took
the first step - category routing sends an administrative `other` requirement to `unknown` via the
`administrative_pattern` evaluator with the rationale "declare a durable profile fact to resolve" -
and reserved the `durable_profile_fact` evaluator in `GAP_EVALUATORS` (ADR-0020 consequence (e)).
M12-03 supplies the facts and wires that reserved evaluator.

This is a new data model (`profile_facts`) plus a sensitive-data privacy stance, distinct from
ADR-0020's taxonomy decision - hence its own ADR. Design authority is the arc package's
Carlos-ratified decisions D-3 (the fact vocabulary) and D-4 (facts are never hard filters), plus the
R1 decision Carlos made at plan time (facts never create a `genuine_gap`) and two blocker fixes an
adversarial design review surfaced before implementation.

## Decision

**A closed six-kind vocabulary (D-3).** `PROFILE_FACT_KINDS = [work_authorization,
visa_sponsorship_needed, relocation_stance, remote_onsite_stance, security_clearance,
availability_notice]`. These mirror what standard job applications actually ask. Salary is
deliberately excluded (it is a WANT - it stays in search criteria, not a fact about the candidate),
and all EEO / demographic fields are deliberately excluded: they carry zero matching value and
modeling them would be wrong. Two kinds are GRADED stances, never booleans (the D-4 nuance):
`relocation_stance` in {willing, open_for_right_opportunity, prefer_not, no} and
`remote_onsite_stance` in {remote_only, prefer_remote, flexible, prefer_onsite, onsite_ok}.
`visa_sponsorship_needed` is a closed yes/no. The other three kinds carry free-form text.

**Facts are informative, NEVER hard filters (D-4).** A fact informs how an administrative requirement
is evaluated; it never excludes a posting. Hard filters remain exclusively in `search_criteria`
(what the operator WANTS), which Carlos curates deliberately. There is no key overlap: facts state
what is true of the candidate, criteria state what they want. The canonical case is relocation -
`open_for_right_opportunity` renders as "you said you would consider relocating for the right role,"
never an exclusion.

**Storage: `profile_facts` (migration 0024).** `id`, `user_id` (FK CASCADE), `kind` (text, CHECK to
the six), `value` (text NOT NULL), `note` (text, nullable), `declared_at` (date), plus timestamps.
`UNIQUE (user_id, kind)` - one current value per kind; history lives in the git of the private
`facts.md`, not in-table. A conditional value CHECK (implication form, the `criteria_adjustments`
0017 precedent) pins the closed-vocabulary values for the three decision-bearing kinds at the DB
too, so the DB and the core Zod schema (`profileFactSchema.superRefine`) can never disagree
(enums.ts DB/app-agree invariant); free-form kinds carry no value clause. Additive, forward-only,
generate-only - a new empty table needs no backfill or hand-edit.

**Source of truth is a markdown file, idempotently re-imported (D-4).** `docs/profile/facts.md`
(and a fictional `docs/profile.example/facts.md`) declares facts in one fenced `yaml` block keyed
`facts`, mirroring `job-criteria.md`. The importer full-syncs by kind: absent-from-file means the row
is deleted, present means upsert - so editing the file and re-running `pnpm profile:import` is how a
fact is updated (an in-app editor is a named v2.2 candidate). `facts.md` is OPTIONAL: a profile
without it imports cleanly.

**Evaluator semantics - satisfied_fact requires a POSITIVE determination, never mere presence.**
The `durable_profile_fact` evaluator resolves an administrative requirement mapped to a fact kind
(the phrase->kind map is derived from the single `ADMINISTRATIVE_FACT_PATTERNS` list so every
committed spelling maps consistently):

- **work_authorization** present -> `satisfied_fact` (confidence `high` when a recognized country
  named in the requirement also appears in the declared value; `medium` otherwise). A recognized
  country CONFLICT (authorized in X, posting requires Y) -> `unknown`, never a false satisfy. Absent
  -> `unknown`.
- **visa_sponsorship_needed** = `no` -> `satisfied_fact`. = `yes` -> `satisfied_fact` ONLY when the
  requirement affirmatively offers sponsorship; otherwise `unknown`. This uses AFFIRMATIVE detection
  (strict token adjacency PLUS a negation-cue guard that leaves any requirement carrying a negation
  anywhere `unknown`), deliberately NOT negative-phrase detection: a negation can never be swallowed,
  so a posting saying "visa sponsorship not available" OR "we do not offer sponsorship" against a
  needs-sponsorship candidate correctly stays `unknown` rather than a silenced satisfy.
- **security_clearance** is never auto-satisfied in v2.1 (level comparison is deferred; holding some
  clearance does not prove it meets an arbitrary required level) -> `unknown` with an honest
  rationale. Absent -> `unknown`.
- **relocation_stance / remote_onsite_stance** never enter the gap route; they enrich the `location`
  requirement's rationale only, never changing its `not_applicable` classification.

**A fact NEVER produces `genuine_gap` (R1, Carlos-confirmed).** Every fact outcome is `satisfied_fact`
or `unknown`. A fact/posting conflict routes to `unknown` ("needs your input") with an honest
conflict-naming rationale, not a gap and not an exclusion. Because facts stay entirely within the
evidence-status classes, they are already excluded from every LLM drafting payload, learning-plan
candidate set, and market-signal Build bucket by the existing `isEvidenceStatusClassification` /
`ACTIONABLE_CLASSIFICATIONS` gates (ADR-0020) - no new cross-cutting guard is needed, and declaring a
fact can never turn an administrative item into a "skill to learn."

**Plumbing keeps facts out of scoring (D-4, structural).** Declared facts thread into `classifyGaps`
as a SEPARATE second argument (defaulted to `[]`), never through the `FitInput` object that `scoreFit`
consumes. So a fact can influence gap classification but is structurally incapable of influencing a
fit score.

**Privacy: facts are a sensitive class.** `scripts/privacy-check.mjs` gains a facts extractor that
probes the free-text `value`/`note` fields of the real `facts.md` whole-string, in the same
normalized space as the contact/location pass, which NEVER consults the publication allowlist - facts
are never allowlistable. Fact VALUES never enter logs, LLM payloads, or OpenAPI examples; the read
surface (`GET /profile/facts`, the Evidence Library) escapes them. Modifying a verification gate
required a demonstrated planted-FAIL in the same change (the CLAUDE.md law): neutering the facts pass
turned exactly the planted test red, other tests green; restoring returned all green.

## Consequences - named residuals and second-order effects

- **(a) satisfied_fact is a thin, honest surface.** In v2.1 the only auto-satisfying facts are
  `visa_sponsorship_needed` and `work_authorization` (country-corroborated). `security_clearance`
  always routes to `unknown`. This is deliberate: the arc's identity is honesty, so the engine only
  asserts "met by fact" when it has a defensible deterministic basis, and everything else is an
  explicit "needs your input" the operator resolves - never a fabricated satisfy.
- **(b) Country matching is bounded.** work_authorization corroboration keys off spelled-out country
  names and national adjectives (United States/America/American, United Kingdom/Britain/British,
  European Union/Europe/European, Canada, Australia, India). The bare two-letter codes (us/uk/eu) are
  DELIBERATELY excluded - "us" collides with the English pronoun and would misread "join us today" as
  the US country group (caught by the pre-push code review). Consequence: an abbreviation-only
  requirement or value corroborates at `medium` (still satisfied, never a false conflict), and only a
  spelled-out match reaches `high`. Country-precise matching beyond this bounded set is a documented
  limitation, folding into the atomic-extraction / skill-model follow-ons. Carlos, the sole operator,
  is US-authorized applying to US roles - satisfied either way (the classification, not the
  confidence tier, is what silences the requirement).
- **(c) The unknown resolution affordance (D-2).** A fact-derived `unknown` renders the facts-aware
  affordance in the Gaps UI ("declare {kind} in facts.md and re-import") with a deep link to the
  Evidence Library declared-facts panel, not the generic "add a skill" affordance.
- **(d) No prompt changes.** Facts never reach a prompt, so the prompt registry is untouched - no new
  prompt version, no live adversarial leg; the injection corpus stays green.
- **(e) Updatability is file-based in v2.1.** `facts.md` + re-import is the update path (each fact
  carries declared/updated dates). An in-app facts editor and private-project ingestion are named
  v2.2 candidates.

## Alternatives considered

- **A `RequirementAssessment` parallel record** - already rejected-with-revisit in ADR-0020; facts
  reuse the same single-row taxonomy.
- **satisfied_fact on mere presence of a fact** - REJECTED (an adversarial design review, blocker): it
  would fabricate a fit conclusion for a non-matching value (an EU-authorized candidate marked
  "satisfied" on a US-citizenship requirement) and misuse the "deterministic proof" meaning of `high`
  confidence. Presence now requires a positive determination.
- **Negative-phrase detection for the sponsorship conflict** - REJECTED (an adversarial design review,
  blocker): the token matcher keeps `no`/`not` as distinct tokens, so a fixed "no sponsorship" phrase
  could never match "sponsorship not available" (the repo's own fixture) and would fail OPEN to a
  silenced satisfy. Inverted to affirmative-only detection, which fails toward `unknown`.
- **A DB CHECK only on `kind`, value vocab in Zod only** - REJECTED for the closed-vocab kinds: the
  repo's implication-CHECK idiom lets the DB pin the stance/yes-no values too, so the invariant holds
  even against a raw-SQL or future-migration write.
- **A fact ever creating a genuine_gap for a conflict** - REJECTED (R1, Carlos): a visa mismatch is a
  decision point ("needs your input"), never a learnable skill gap, and never an exclusion.
