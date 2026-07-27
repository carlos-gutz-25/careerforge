# ADR-0018: Resume Studio - composed-with-provenance

**Status:** Accepted - **Date:** 2026-07-27

## Context

ADR-0012 structurally barred the LLM from composing resume text: the DB held no verifiable source
prose (skills were name/level, experiences were company/title/dates, no bullets), so any composed
sentence would be text the system could not check against a source - the product's core failure mode
(fabrication, RISKS H-01). Tailoring was therefore spec-not-prose: the model ordered and emphasized,
a deterministic renderer built every body string from a DB row.

The substrate has since changed. M2-12 captured the user's own verified experience bullets
(`profile_experience_bullets`); M3-03 added mastery evidence; M6-01 added the deterministic contact
header, the authored Professional Summary blocks (`profile_summaries`), and education
(`profile_education`). There is now a corpus of user-authored, verified prose the system CAN check a
composed sentence against. On that basis the operator explicitly chose **LLM-drafted resume prose**
for Resume Studio over a selection-only guide (V2-PLAN section 1 decision 4, section 3.1).

M6-02 (this change) records the decision and ships the deterministic **claim-provenance gate** as a
pure module in `packages/scoring`, plus the core claim contracts M6-03 (prompt/payload) and M6-04
(service/routes/tables) will consume. It ships nothing that RUNS the gate - no migration, no route,
no prompt (V2-PLAN scope). This is a **new ADR, not an ADR-0012 amendment** (the 0010/0012/0013/0017
"mint new, don't amend" reasoning): it is a distinct architectural decision that supersedes ADR-0012
in part rather than editing its record.

## Decision

- **The honesty guarantee shifts from by-construction to by-validation plus mandatory human review.**
  ADR-0012 made fabrication impossible because the schema had no field that could carry prose. Resume
  Studio instead LETS the model draft prose and catches fabrication with a deterministic gate before
  anything is written, with human review as the required backstop for what deterministic checks
  cannot see (see Residuals). Draft-until-reviewed (ADR-0005) is unchanged: nothing is ever sent.

- **ADR-0012 is superseded IN PART - two artifacts, one primary.** ADR-0012's guide artifact survives
  untouched: `resume_variants` and the `resume-tailoring` v1/v2 prompts (their pins frozen) remain the
  secondary "tailoring notes" view - an emphasis guide over verified facts, governed by ADR-0012 and
  its `validateTailoringSpec` gate. The new **composed** `resume_documents` artifact (M6-04) is the
  Resume Studio PRIMARY. The UI must never present one as the other (V2-PLAN section 3.1, "two
  artifacts, one primary"); they are distinct records with distinct honesty gates.

- **The claim contract (packages/core, M6-02).** A `resumeClaimDraft` is one model-drafted sentence
  bound to the evidence it paraphrases: `{ text, section in {summary, experience, project}, entityRef
  (null iff summary), citationRefs (1..4) }`. Caps (`text <=300`, summary section total `<=600`,
  `<=40` claims, `<=6`/experience, `<=4`/project) are ONE shared definition imported by the M6-03
  output schema, the M6-04 boundary, and the gate, so the three can never disagree. Element shape is
  zod; everything beyond it is a gate law (below), so there is a single verdict site and M6-03/M6-04
  cannot half-enforce.

- **The gate's laws (packages/scoring `checkClaimProvenance`, pure and deterministic).** Each law is a
  separately-testable check; a violation carries its law id:
  - **L1 citation_membership** - every cited ref was sent as evidence; no duplicate ref within a claim.
  - **L2 numeric** - every number in the claim appears (digit-based, thousands-separator-insensitive,
    decimals and versions as-written) in a CITED source; a unit-marked number (`40%`, `$50`)
    additionally needs a compatible marker (`%` <-> percent, `$` <-> dollars/usd) in a cited source.
  - **L3 vocabulary** - any profile skill phrase the claim asserts must be backed by a cited source
    (the fit engine's single `phraseMatches` semantics, gap 2).
  - **L4 provenance_class** - two INDEPENDENT structural locks. (i) ownership: an experience/project
    claim may cite only its own entity's evidence; a summary claim may cite any sent evidence. (ii)
    class: `personal` / `personal_ai_assisted` evidence can NEVER back an experience-section claim -
    kept as its own assertion so a future ownership loosening cannot silently drop the "never under
    employment" law. A professional project linked to an experience is still NOT citable under that
    experience in v2 (the one contemplated future loosening, named so it is a decision, not an
    accident).
  - **L5 external_pointer** - `containsExternalPointer(claim.text)` flags (ADR-0017 lineage). Resume
    body prose never carries URLs/emails/domains; links belong to the deterministic contact header.
    This is an addition BEYOND V2-PLAN section 3.1's four laws.
  - **L6 shape** - the cross-field and aggregate caps above (entityRef-null-iff-summary; entityRef in
    the sent entities; text and count caps).
  - The **untrusted-text law** is NOT a gate check - it is a RENDERING-side law enforced at M6-04/05:
    claims render escaped, the submittable document contains no posting-derived strings, and
    requirements GUIDE selection but never enter the document.

- **Violation semantics and server-side enforcement.** ANY violation -> the run is `flagged` and
  NOTHING is written (the house flag-the-run-write-nothing tripwire, shared with every drafting
  family). Enforcement is server-side pre-insert (M6-04 wires the gate). Every gate input EXCEPT the
  claims themselves - the evidence catalog, the sent entities, the skill vocabulary - is re-derived
  server-side from the DB at verdict time, never accepted from the client: the gate is pure and
  verdicts only what it is shown, so a client-supplied catalog or an empty vocabulary would gut every
  law while returning ok (an empty `skillVocabulary` makes L3 vacuously pass). This is the M4-02
  never-trust-the-client spine, carried to M6-04 as a binding obligation.

- **Conservative tie-break, the gate's design law.** Wherever a deterministic comparison is
  ambiguous, the gate FLAGS. Over-flag routes to human review (safe); under-flag is the failure mode.
  Every gate edge case (currency symbol placement, `k` suffix on a year like `401k`,
  decimal-vs-thousands ambiguity) resolves against this rule rather than growing an unpinned special
  case; each named edge is a pinned test row.

## Residuals (named honestly - a flag means review, not loss)

- **Semantic overstatement composed only of evidenced tokens and numbers passes every deterministic
  check.** "Led a team of 8" when the evidence says "worked in a team of 8" uses only cited words and
  the cited number, so L2/L3 pass. Human review is the backstop, stated plainly (V2-PLAN risk 1). The
  gate proves provenance of tokens and numbers, not truth of their arrangement.

- **Word-number evasion.** Numeric extraction is digit-based, so "forty percent" is invisible to L2.
  The M6-03 prompt instructs digits-as-written, and human review backstops; a conservative future
  option (flag spelled-out quantities) is recorded, not built.

- **Unit/multiplier conservatism.** `1.2M` and `1,200,000` do NOT match (no multiplier expansion): a
  claim `1.2M` requires evidence containing `1.2M`, otherwise it FLAGS. Over-flag is the safe
  direction; the user resolves by rephrase or redraft.

## Alternatives Considered

- **Selection-only prose (keep ADR-0012's model for Resume Studio too).** Rejected-but-revisitable.
  It is strictly safer (fabrication impossible by construction), but it cannot produce a submittable
  composed resume - the operator's stated goal - and forces the user to hand-write every sentence.
  Named revisit trigger: if dogfood shows the gate's flag rate makes drafting net-negative (more time
  spent resolving flags than writing from scratch), fall back to selection-only for the composed
  surface. The guide artifact already IS selection-only, so the fallback path exists.

- **Unconstrained drafting (trust the prompt).** Rejected outright. A prompt instruction is not an
  enforcement boundary; the whole point of the gate is that fabrication is caught in code, not asked
  for in prose.

## Consequences

- **No schema, no route, no prompt in this change.** M6-02 ships the ADR + the core claim contracts +
  the pure gate + tests only. The gate is born with unit tests but no runtime caller until M6-04
  wires it pre-insert (migration 0019, its own plan-gate). Settling the law and its enforcement
  primitive before any table or prompt depends on them mirrors ADR-0017's M7-01a/M7-01b sequencing.

- **Export/determinism posture (direction, decided at M6-05/06).** Exports (PDF via pdfmake, DOCX)
  are deterministic (golden-byte tested), reviewed-only, and a parse-audit re-reads the exported file
  to confirm what a machine sees. ATS "coverage" is reported as honest, itemized signal, never one
  merged "ATS score" that implies a guarantee. This ADR fixes only that posture; the libraries and
  their own decisions land in M6-05/06.

- **The gate is a shared pure primitive.** `checkClaimProvenance` lives in `packages/scoring` beside
  the other deterministic engines; it never imports `packages/llm` (the module wall). M6-04 is its
  first and only caller.

- **Gate-update ledger (V2-PLAN section 7).** M6-02 owes and ships the neutered-gate planted-FAIL at
  TEST level (each law neutered in turn turns exactly its rows red, restored to green). The
  route-level tamper proof (a tampered claim reaching the API is flagged) is M6-04's share of the
  ledger row - this story has no route to tamper.

- **Numbering.** v2 ADR numbers are assigned at merge order against `origin/main` (PLAN 7.3, V2-PLAN
  section 6). 0016 (design-system) and 0017 (external-recommendation-honesty) are taken; this ADR is
  **0018**, verified lowest-free against `origin/main` at push time. The reserved
  `RESERVED-resume-studio-composed-with-provenance.md` stub is discharged by this rename.

## Value

- **Product:** a submittable resume the model can draft AND the user can trust, because every number,
  skill, and claim is provably paraphrased from the user's own verified evidence or the draft is
  flagged and never written - and the honest guide artifact remains alongside it, never confused for
  the primary.
- **Skills:** demonstrates deterministic provenance validation over free LLM prose - digit-exact
  numeric matching, structural provenance locks kept independent so a future loosening cannot drop a
  safety law, a single shared claim contract across prompt/boundary/gate, and named residuals with a
  conservative-flag design law rather than silent gaps.
- **Employability:** the same honesty-first differentiator that runs through the fit, resume-tailoring,
  interview-prep, and coaching surfaces, now taken to the hardest case - letting the model write, and
  proving in code that it cannot fabricate, instead of forbidding it from writing at all.
