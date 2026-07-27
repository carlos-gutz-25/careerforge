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
