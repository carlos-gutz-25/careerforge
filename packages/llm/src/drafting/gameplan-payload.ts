import {
  type EvidenceStrength,
  type GapClassification,
  type PlanItemPriority,
  type PlanReviewStatus,
  type RequirementCategory,
  type RequirementKind,
  type SkillLevel,
} from '@careerforge/core';

// The application-gameplan drafting payload builder (M7-06, ADR-0019 layer L2
// context; the M3-04 interview-payload template). Pure data-in/string-out - no
// DB, no provider, no clock/random. The ONE serialization site for what a
// gameplan drafting call may see (ADR-0005 section 3: verified structured data only).
// The strings inside are posting/profile-DERIVED (requirement text, evidence
// quotes) or LLM-DRAFTED (reviewed improvement-plan item text) and therefore
// UNTRUSTED - the whole document enters the call SOLELY as runPrompt's
// untrustedData, wrapped in the fresh per-attempt random boundary (ADR-0006
// layer 1). Raw posting text never re-enters an LLM call.
//
// Refs: requirements r1..rN, evidence e1..eM (global numbering, assigned in
// requirement order). The model cites refs; M7-07's service maps them back and
// runs the story-citation tripwire off `evidenceByRef`'s (link id, owning
// requirement ref) PAIR (the interview-prep idiom). GAPS CARRY NO REFS (the
// M3-04 design pin): a gap rides inline on its requirement (`gapClassification`)
// and the model never addresses a gap by ref.
//
// Two deltas from buildInterviewPayload: (1) an improvement-plan GUIDANCE
// section, serialized IFF the plan is reviewed and non-empty - action text +
// priority only, NEVER citable, no ids, no refs (the ADR-0019 "improvement-plan
// items only when reviewed" law lives HERE in the pure builder where it is
// unit-testable, belt-and-braces with M7-07's read-only-reviewed service);
// (2) NO disclosure machinery - the gameplan has no disclosure tripwire (its two
// tripwires are message-likeness + story-citation), so honesty about gaps is
// prompt-instructed strategy content, not a per-question obligation.

export interface GameplanSkillInput {
  name: string;
  level: SkillLevel;
}

export interface GameplanRequirementInput {
  requirementId: string;
  /** M1-06 tristate. ONLY `=== true` enters the payload (gate condition 1):
   *  `false` failed verification, `null` was never verified - both are excluded
   *  and counted, never sent, and their evidence is dropped entirely. */
  quoteVerified: boolean | null;
  text: string;
  kind: RequirementKind;
  category: RequirementCategory;
  /** The requirement's gap row on THIS report, if any. ABSENT (null) means no
   *  classification exists - NOT "have". The classification is the EFFECTIVE
   *  (post-review) value; it serializes inline, refless. */
  gap: { gapId: string; classification: GapClassification } | null;
}

export interface GameplanEvidenceInput {
  evidenceLinkId: string;
  /** Evidence attaches to its requirement within the single loaded report, so
   *  requirementId alone is the key (the interview-payload precedent). */
  requirementId: string;
  strength: EvidenceStrength;
  postingQuote: string;
  profileQuote: string;
}

/** The candidate's improvement plan as gameplan GUIDANCE context. Serialized
 *  into the payload IFF `reviewStatus === 'reviewed'` and at least one item
 *  exists - the ADR-0019 reviewed-only law, enforced in this pure builder. */
export interface GameplanImprovementPlanInput {
  reviewStatus: PlanReviewStatus;
  items: readonly { action: string; priority: PlanItemPriority }[];
}

/** Evidence quotes per requirement are capped: enough to ground a STAR story,
 *  bounded token cost (the INTERVIEW_EVIDENCE_PER_REQUIREMENT_CAP figure). */
export const GAMEPLAN_EVIDENCE_PER_REQUIREMENT_CAP = 3;

/** A story cites evidence of ONE requirement, and at most
 *  GAMEPLAN_EVIDENCE_PER_REQUIREMENT_CAP pieces of evidence are ever sent per
 *  requirement - so the story-citation cap and the evidence-per-requirement cap
 *  are ONE NUMBER by construction. A unit test asserts they are equal so a
 *  future edit to one forces the other to be reconsidered. The prompt module
 *  imports THIS const for its `citationRefs` zod bound (no cycle: this module
 *  imports nothing from the registry). */
export const GAMEPLAN_STORY_CITATIONS_MAX = GAMEPLAN_EVIDENCE_PER_REQUIREMENT_CAP;

/** An e-ref's resolution: the link id AND its owning requirement's ref - the
 *  pair M7-07's story-citation tripwire keys on (each cited evidence must belong
 *  to the requirement the story targets), and the D8 evaluator's count basis. */
export interface GameplanEvidenceRef {
  evidenceLinkId: string;
  requirementRef: string;
}

export interface GameplanPayload {
  /** The JSON document handed to runPrompt as untrustedData. */
  payload: string;
  /** ref (r1...) -> requirement id: citation/target validation at M7-07. */
  requirementIdByRef: ReadonlyMap<string, string>;
  /** ref (e1...) -> link id + owning requirement ref: the story-citation tripwire's
   *  key and the evaluator's cross-requirement-bleed basis. */
  evidenceByRef: ReadonlyMap<string, GameplanEvidenceRef>;
  /** Verified (=== true) requirements included - 0 means nothing to draft (the
   *  M7-07 service 409s BEFORE any paid call). */
  verifiedRequirementCount: number;
  /** Requirements excluded by the strict filter (false OR null) - value-free
   *  route-log telemetry, never sent anywhere. */
  excludedRequirementCount: number;
  /** Improvement-plan items actually serialized into the payload (0 when the
   *  plan is null, draft, or empty) - value-free telemetry. */
  includedPlanItemCount: number;
}

/**
 * Builds the application-gameplan drafting payload from verified structured
 * inputs. The verified filter is STRICT `=== true` (gate condition 1). Refs
 * r1..rN number the verified requirements in input order; evidence attaches per
 * requirement by requirementId, capped at GAMEPLAN_EVIDENCE_PER_REQUIREMENT_CAP,
 * with e-refs numbered globally in requirement order. A requirement's gap
 * classification serializes inline (refless) WHEN a gap row exists; a no-gap-row
 * requirement omits the field entirely (absent, not null). Evidence for excluded
 * requirements is dropped entirely - nothing of theirs reaches the payload. The
 * improvement plan is serialized as non-citable guidance IFF it is reviewed and
 * non-empty.
 */
export function buildGameplanPayload(
  skills: readonly GameplanSkillInput[],
  requirements: readonly GameplanRequirementInput[],
  evidence: readonly GameplanEvidenceInput[],
  improvementPlan: GameplanImprovementPlanInput | null,
): GameplanPayload {
  const verified = requirements.filter((requirement) => requirement.quoteVerified === true);

  const evidenceByRequirement = new Map<string, GameplanEvidenceInput[]>();
  for (const link of evidence) {
    const bucket = evidenceByRequirement.get(link.requirementId);
    if (bucket) bucket.push(link);
    else evidenceByRequirement.set(link.requirementId, [link]);
  }

  const requirementIdByRef = new Map<string, string>();
  const evidenceByRef = new Map<string, GameplanEvidenceRef>();

  let evidenceCounter = 0;
  const requirementsJson = verified.map((requirement, index) => {
    const ref = `r${String(index + 1)}`;
    requirementIdByRef.set(ref, requirement.requirementId);

    const links = (evidenceByRequirement.get(requirement.requirementId) ?? []).slice(
      0,
      GAMEPLAN_EVIDENCE_PER_REQUIREMENT_CAP,
    );
    const evidenceJson = links.map((link) => {
      evidenceCounter += 1;
      const evidenceRef = `e${String(evidenceCounter)}`;
      evidenceByRef.set(evidenceRef, {
        evidenceLinkId: link.evidenceLinkId,
        requirementRef: ref,
      });
      return {
        ref: evidenceRef,
        strength: link.strength,
        postingQuote: link.postingQuote,
        profileQuote: link.profileQuote,
      };
    });

    return {
      ref,
      kind: requirement.kind,
      category: requirement.category,
      requirement: requirement.text,
      // Absent field (not null) when no gap row exists - the model sees a
      // classification only where one actually exists. Gaps carry no ref.
      ...(requirement.gap ? { gapClassification: requirement.gap.classification } : {}),
      evidence: evidenceJson,
    };
  });

  // Reviewed-only guidance (ADR-0019). Null, draft, or empty -> the key is ABSENT
  // (not an empty section) and includedPlanItemCount is 0.
  const includedPlanItems =
    improvementPlan !== null && improvementPlan.reviewStatus === 'reviewed'
      ? improvementPlan.items
      : [];
  const guidanceJson =
    includedPlanItems.length > 0
      ? {
          improvementPlan: {
            // action text + priority ONLY - no ids, no refs, nothing citable.
            items: includedPlanItems.map((item) => ({
              action: item.action,
              priority: item.priority,
            })),
          },
        }
      : {};

  const payload = JSON.stringify(
    {
      profileSkills: skills.map((skill) => ({ name: skill.name, level: skill.level })),
      requirements: requirementsJson,
      ...guidanceJson,
    },
    null,
    2,
  );

  return {
    payload,
    requirementIdByRef,
    evidenceByRef,
    verifiedRequirementCount: verified.length,
    excludedRequirementCount: requirements.length - verified.length,
    includedPlanItemCount: includedPlanItems.length,
  };
}
