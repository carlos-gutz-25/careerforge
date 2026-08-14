import { z } from 'zod';

// M6-02 - the shared claim contracts for Resume Studio's composed-with-provenance
// path (ADR-0018). A "claim" is one model-drafted resume sentence bound to the
// profile evidence it paraphrases: the M6-03 prompt emits these, the M6-04
// boundary validates + persists them, and the packages/scoring claim-provenance
// gate (checkClaimProvenance) is the SINGLE verdict site that decides whether a
// draft may be written or must be flagged. These consts + schema are that one
// definition, imported by all three so file, wire, prompt and gate can never
// disagree (the interview.ts consts+schema idiom, the search_criteria law).
//
// Pure and browser-safe: consts + a zod ELEMENT-shape schema only. Everything
// beyond element shape (text length, per-entity claim caps, summary total,
// entityRef-null-iff-summary, citation uniqueness, cross-provenance) is a GATE
// law (sec D3 L1/L6), NOT a zod refinement, so a policy violation produces a
// flagged RUN carrying a law id (the house tripwire) rather than a 400 at the
// boundary - one verdict site, so M6-03/M6-04 cannot half-enforce (ADR-0018).

/** The three resume regions a claim can occupy. A `summary` claim is global
 *  (no entity); an `experience`/`project` claim binds to one sent entity. */
export const RESUME_CLAIM_SECTIONS = ['summary', 'experience', 'project'] as const;
export const resumeClaimSectionSchema = z.enum(RESUME_CLAIM_SECTIONS);
export type ResumeClaimSection = z.infer<typeof resumeClaimSectionSchema>;

// Caps - ONE definition shared by the M6-03 output schema, the M6-04 boundary,
// and the gate. The text/aggregate caps are enforced at the gate (L6), not as
// zod refinements, so an over-cap draft FLAGS (human review) instead of 400-ing
// (the conservative tie-break, ADR-0018: over-flag is the safe direction).

/** Every single claim's text is <=300 chars (gate L6). */
export const RESUME_CLAIM_TEXT_MAX_CHARS = 300;
/** The summary section's claim texts additionally total <=600 chars (gate L6).
 *  Resolves the V2-PLAN "summary <=600" ambiguity: per-claim 300 AND section 600. */
export const RESUME_SUMMARY_TOTAL_MAX_CHARS = 600;
/** Citation cardinality per claim - element shape (zod), so 0 or >4 is a 400. */
export const RESUME_CLAIM_MIN_CITATIONS = 1;
export const RESUME_CLAIM_MAX_CITATIONS = 4;
/** Aggregate caps (gate L6). */
export const RESUME_MAX_CLAIMS = 40;
export const RESUME_MAX_CLAIMS_PER_EXPERIENCE = 6;
export const RESUME_MAX_CLAIMS_PER_PROJECT = 4;

/**
 * One model-drafted resume claim, ELEMENT shape only. `entityRef` is the sent
 * experience/project id the claim belongs to (null for a summary claim - the
 * null-iff-summary law is a GATE check, L6, not encoded here). `citationRefs`
 * are opaque evidence refs (the gate's shape-agnostic input contract, sec D2); the
 * min/max is element cardinality, but membership + uniqueness are gate laws (L1).
 * `text` carries no `.max()` on purpose: the length cap is L6 so an over-long
 * draft flags rather than 400s.
 */
export const resumeClaimDraftSchema = z.strictObject({
  text: z.string(),
  section: resumeClaimSectionSchema,
  entityRef: z.string().nullable(),
  citationRefs: z.array(z.string()).min(RESUME_CLAIM_MIN_CITATIONS).max(RESUME_CLAIM_MAX_CITATIONS),
});
export type ResumeClaimDraft = z.infer<typeof resumeClaimDraftSchema>;

// M15-01 - the gate's law vocabulary lives HERE, not in packages/scoring, and
// scoring re-exports it. Forced, not stylistic (plan D0): apps/web declares
// @careerforge/core as its only @careerforge/* RUNTIME dependency, so a web
// component cannot type against scoring, and core cannot import scoring without
// cycling (scoring imports core). Both lists are the single definition shared by
// the gate, the run row, the wire and the banner.

/** Law ids, in violation-sort order. The ORDER is load-bearing: the gate ranks
 *  violations by `CLAIM_PROVENANCE_LAWS.indexOf(law)`, so reordering this array
 *  silently reorders every reported violation set. */
export const CLAIM_PROVENANCE_LAWS = [
  'citation_membership',
  'numeric',
  'vocabulary',
  'provenance_class',
  'external_pointer',
  'shape',
] as const;
export type ClaimProvenanceLaw = (typeof CLAIM_PROVENANCE_LAWS)[number];

/** The `shape` law's EIGHT sub-rules, one per structural check the gate makes
 *  (plan D2). Reporting bare `shape` tells an operator "structural, not a lie",
 *  which is true but not actionable; the sub-rule names WHICH structure failed.
 *  Order matches the checks as the gate evaluates them:
 *  - `entity_ref_forbidden` - a `summary` claim carries an entityRef
 *  - `entity_ref_missing`   - a non-summary claim has a null entityRef
 *  - `entity_ref_unknown`   - the entityRef is absent from the sent entity pool
 *  - `claim_text_cap`       - one claim's text exceeds RESUME_CLAIM_TEXT_MAX_CHARS
 *  - `claim_count_cap`      - the claim index reaches RESUME_MAX_CLAIMS
 *  - `experience_claim_cap` - one experience exceeds RESUME_MAX_CLAIMS_PER_EXPERIENCE
 *  - `project_claim_cap`    - one project exceeds RESUME_MAX_CLAIMS_PER_PROJECT
 *  - `summary_total_cap`    - the running summary total exceeds RESUME_SUMMARY_TOTAL_MAX_CHARS
 *  The last four are AGGREGATE caps: no single claim is defective, the SET is
 *  too large. That distinction is what makes an honest banner possible. */
export const CLAIM_SHAPE_RULES = [
  'entity_ref_forbidden',
  'entity_ref_missing',
  'entity_ref_unknown',
  'claim_text_cap',
  'claim_count_cap',
  'experience_claim_cap',
  'project_claim_cap',
  'summary_total_cap',
] as const;
export type ClaimShapeRule = (typeof CLAIM_SHAPE_RULES)[number];

/**
 * The SAFE shape of one recorded gate violation - the single element definition
 * shared by three sinks: the run row's `gate_violations` payload, the POST 201
 * wire body, and the projection that builds it (plan D3).
 *
 * What is ABSENT is the point. The gate's in-memory violation also carries
 * `refs` and `token`, and NEITHER may be persisted, logged or returned. `token`
 * may echo posting-derived text; `refs` is the subtler hazard, because a
 * `citation_membership` violation pushes the refs that did NOT resolve - strings
 * the model invented after reading the posting. A rule of "keep refs, drop
 * token" would be wrong, so both go. `strictObject` guards the WIRE sink; the
 * projection guards all three by CONSTRUCTION, naming its output fields rather
 * than spreading the source violation, so a field nobody wrote cannot leak.
 *
 * `section` is zipped from the claim set, and is the only thing that makes
 * `claimIndex` legible: a flagged run persists no claims.
 */
export const resumeGateViolationSchema = z.strictObject({
  claimIndex: z.number().int().min(0),
  section: resumeClaimSectionSchema,
  law: z.enum(CLAIM_PROVENANCE_LAWS),
  detail: z.array(z.enum(CLAIM_SHAPE_RULES)).optional(),
});
export type ResumeGateViolation = z.infer<typeof resumeGateViolationSchema>;

// M15-03 (ADR-0018) - the AGGREGATE-CAP DEGRADE path. Everything below is pure
// and deterministic: no DB, no LLM, no clock. It never re-ranks and never
// re-summarizes, and condition 3 forbids ever calling the model again.

/** The four AGGREGATE sub-rules of the `shape` law - the ONLY class this story
 *  degrades. The distinction is the whole argument: for these four no single
 *  claim is defective, the SET is too large, so a fully lawful sub-document
 *  already exists inside the flagged draft. The other four shape sub-rules are
 *  PER-CLAIM defects (the claim itself is malformed) and still reject wholesale,
 *  as do all five truthfulness laws.
 *
 *  Deliberately a separate list rather than a slice of CLAIM_SHAPE_RULES: the
 *  membership is a LAW, not an ordering coincidence, and a slice would silently
 *  re-classify a rule if anyone reordered that array. A unit test pins this list
 *  against CLAIM_SHAPE_RULES so the two cannot drift apart unnoticed. */
export const AGGREGATE_CLAIM_SHAPE_RULES = [
  'claim_count_cap',
  'experience_claim_cap',
  'project_claim_cap',
  'summary_total_cap',
] as const;
export type AggregateClaimShapeRule = (typeof AGGREGATE_CLAIM_SHAPE_RULES)[number];

const AGGREGATE_RULE_SET: ReadonlySet<string> = new Set(AGGREGATE_CLAIM_SHAPE_RULES);

/**
 * Is this violation set degradable - i.e. AGGREGATE-CAP breaches and NOTHING
 * else? (Condition 1: degrade is a trim of an otherwise-clean draft, NEVER a
 * repair path. Any truthfulness violation or per-claim shape defect present
 * means the whole draft rejects.)
 *
 * CONSERVATIVE BY CONSTRUCTION, in ADR-0018's over-flag direction: a violation
 * qualifies only if it is the `shape` law AND carries a non-empty `detail` whose
 * every member is one of the four aggregate rules. A `shape` violation with no
 * `detail` is NOT provably aggregate, so it does not qualify and the draft
 * rejects. Under-flagging is the failure mode; refusing to degrade is always safe.
 *
 * An EMPTY violation set returns false: there is nothing to degrade, and that
 * case is plain `ok`. Callers must not read false as "reject" without checking
 * whether the gate flagged anything at all.
 */
export function isAggregateOnlyViolationSet(violations: readonly ResumeGateViolation[]): boolean {
  if (violations.length === 0) return false;
  return violations.every(
    (violation) =>
      violation.law === 'shape' &&
      violation.detail !== undefined &&
      violation.detail.length > 0 &&
      violation.detail.every((rule) => AGGREGATE_RULE_SET.has(rule)),
  );
}

/** What was removed, so the document and the UI can say it plainly (condition 2:
 *  disclosed, never silent). Names the caps that fired and the per-section drop
 *  counts - the two facts the banner sentence needs. */
/** Zod rather than a bare interface because this crosses TWO boundaries: it is
 *  persisted as jsonb (resume_documents.degrade_disclosure) and returned on the
 *  wire, and the repo's law is validation at every boundary. `strictObject` so a
 *  field nobody declared cannot ride along into either sink. */
export const aggregateTrimDisclosureSchema = z.strictObject({
  /** The aggregate caps that actually fired, in CLAIM_SHAPE_RULES order. */
  caps: z.array(z.enum(AGGREGATE_CLAIM_SHAPE_RULES)).min(1),
  /** Per-section drop counts, section order per RESUME_CLAIM_SECTIONS; sections
   *  that lost nothing are omitted rather than reported as zero. */
  droppedBySection: z
    .array(z.strictObject({ section: resumeClaimSectionSchema, count: z.number().int().min(1) }))
    .min(1),
  /** Total claims removed. Always equals the flagged claim count. Min 1: a
   *  disclosure exists ONLY when something was actually dropped - a zero-drop
   *  disclosure would be a contradiction, so the schema refuses to represent it. */
  droppedCount: z.number().int().min(1),
});
export type AggregateTrimDisclosure = z.infer<typeof aggregateTrimDisclosureSchema>;

export interface AggregateTrimResult {
  /** The surviving claims, in their original relative order. */
  claims: ResumeClaimDraft[];
  disclosure: AggregateTrimDisclosure;
}

/**
 * Drop EXACTLY the claims the gate flagged, and disclose what went.
 *
 * The provable identity this rests on (review-seat ruling 2026-08-06, adopted
 * over the original model-ordering rationale, which was an unevidenced
 * assumption about model behaviour): for all four aggregate caps, "drop from the
 * end of the offending group until the cap is satisfied" is IDENTICAL to "drop
 * exactly the claims the gate flagged", because every aggregate rule flags
 * monotonically from its crossing point onward. Verified against the gate's own
 * code: `claim_count_cap` flags every index >= RESUME_MAX_CLAIMS; the two
 * per-entity caps flag that entity's tail once its running count passes the cap;
 * and `summary_total_cap` accumulates a running total that only ever increases,
 * so its flagged set is the suffix beginning at the crossing claim and the total
 * BEFORE that claim was by definition already lawful.
 *
 * So the trimmed document contains PRECISELY the claims that passed every one of
 * the six laws, and nothing else. That is enforcement, not editing - which is
 * what makes condition 2's disclosure literally true.
 *
 * Re-running the gate over the result yields no violations: dropping claims only
 * ever LOWERS indices, per-entity counts and the summary running total, and none
 * of the four caps can be crossed by a smaller set.
 *
 * The caller is responsible for having established that the set is degradable
 * (isAggregateOnlyViolationSet). This function trims whatever it is handed - it
 * is not a second verdict site, because the gate is the single verdict site.
 */
export function trimAggregateOverflow(
  claims: readonly ResumeClaimDraft[],
  violations: readonly ResumeGateViolation[],
): AggregateTrimResult {
  const flagged = new Set<number>();
  for (const violation of violations) flagged.add(violation.claimIndex);

  const kept: ResumeClaimDraft[] = [];
  const bySection = new Map<ResumeClaimSection, number>();
  claims.forEach((claim, index) => {
    if (!flagged.has(index)) {
      kept.push(claim);
      return;
    }
    // The claim's OWN section, not the violation's: the violation zips section
    // from the claim set, so they agree, and reading it from the claim keeps this
    // function correct even if it is ever handed a hand-built violation.
    bySection.set(claim.section, (bySection.get(claim.section) ?? 0) + 1);
  });

  const caps = new Set<AggregateClaimShapeRule>();
  for (const violation of violations) {
    for (const rule of violation.detail ?? []) {
      if (AGGREGATE_RULE_SET.has(rule)) caps.add(rule as AggregateClaimShapeRule);
    }
  }

  return {
    claims: kept,
    disclosure: {
      caps: AGGREGATE_CLAIM_SHAPE_RULES.filter((rule) => caps.has(rule)),
      droppedBySection: RESUME_CLAIM_SECTIONS.filter((section) => bySection.has(section)).map(
        (section) => ({ section, count: bySection.get(section) ?? 0 }),
      ),
      droppedCount: claims.length - kept.length,
    },
  };
}
