import type {
  EvidenceStrength,
  GapClassification,
  RequirementCategory,
  RequirementKind,
  SkillLevel,
} from '@careerforge/core';

// The drafting payload builder (M1-12 §3): pure data-in/string-out — no DB,
// no provider, no clock. The ONE serialization site for what a drafting call
// may see (ADR-0005 §3: verified structured data only; the strings inside
// are posting/profile-DERIVED and therefore untrusted — the whole document
// enters the call solely as runPrompt's untrustedData, inside the random
// boundary markers). Gaps are keyed by short synthetic refs (g1, g2, …), not
// UUIDs: the model cites a ref, the server maps it back — no id
// transcription surface, fewer tokens.

export interface DraftingSkillInput {
  name: string;
  level: SkillLevel;
}

export interface DraftingGapInput {
  gapId: string;
  /** EFFECTIVE classification (overrides respected — drafting is gated on a
   *  reviewed report, so this is the post-review value). */
  classification: GapClassification;
  requirementId: string;
  requirementText: string;
  requirementKind: RequirementKind;
  requirementCategory: RequirementCategory;
  rationale: string;
}

export interface DraftingEvidenceInput {
  requirementId: string;
  strength: EvidenceStrength;
  postingQuote: string;
  profileQuote: string;
}

/** Evidence quotes per gap are capped: enough to ground an action, bounded
 *  token cost (M1-12 §3). */
export const EVIDENCE_PER_GAP_CAP = 3;

export interface DraftingPayload {
  /** The JSON document handed to runPrompt as untrustedData. */
  payload: string;
  /** ref (g1…) → gap id: the citation-validation map (M1-12 §3). */
  gapIdByRef: ReadonlyMap<string, string>;
  /** Eligible (non-'have') gaps included — 0 means nothing to draft
   *  (the service 409s BEFORE any paid call). */
  eligibleGapCount: number;
}

/**
 * Builds the drafting payload from verified structured inputs. 'have' gaps
 * are excluded (nothing to improve); refs number the ELIGIBLE gaps in the
 * given order. Evidence attaches per gap via requirementId, capped at
 * EVIDENCE_PER_GAP_CAP — evidence whose requirement belongs to NO eligible
 * gap is dropped entirely (the R3 pin: unverified/unscored requirements
 * never have gap rows, so nothing of theirs can reach the payload).
 */
export function buildDraftingPayload(
  skills: readonly DraftingSkillInput[],
  gaps: readonly DraftingGapInput[],
  evidence: readonly DraftingEvidenceInput[],
): DraftingPayload {
  const eligible = gaps.filter((gap) => gap.classification !== 'have');

  const evidenceByRequirement = new Map<string, DraftingEvidenceInput[]>();
  for (const link of evidence) {
    const bucket = evidenceByRequirement.get(link.requirementId);
    if (bucket) bucket.push(link);
    else evidenceByRequirement.set(link.requirementId, [link]);
  }

  const gapIdByRef = new Map<string, string>();
  const gapsJson = eligible.map((gap, index) => {
    const ref = `g${String(index + 1)}`;
    gapIdByRef.set(ref, gap.gapId);
    return {
      ref,
      classification: gap.classification,
      kind: gap.requirementKind,
      category: gap.requirementCategory,
      requirement: gap.requirementText,
      rationale: gap.rationale,
      evidence: (evidenceByRequirement.get(gap.requirementId) ?? [])
        .slice(0, EVIDENCE_PER_GAP_CAP)
        .map((link) => ({
          strength: link.strength,
          postingQuote: link.postingQuote,
          profileQuote: link.profileQuote,
        })),
    };
  });

  const payload = JSON.stringify(
    {
      profileSkills: skills.map((skill) => ({ name: skill.name, level: skill.level })),
      gaps: gapsJson,
    },
    null,
    2,
  );

  return { payload, gapIdByRef, eligibleGapCount: eligible.length };
}

export interface CitationMapping {
  /** gap id per item, in item order — defined ONLY when every ref is known. */
  gapIds: string[] | undefined;
  /** How many cited refs were NOT in the sent set (fabrications — the
   *  layer-4 tripwire signal; the count is value-free telemetry). */
  fabricatedRefCount: number;
}

/** Maps cited refs back to gap ids (M1-12 §3 citation validation). Any
 *  unknown ref means the whole output is untrustworthy: gapIds is undefined
 *  and the run must be persisted 'flagged' with NO plan row. */
export function mapCitedRefs(
  refs: readonly string[],
  gapIdByRef: ReadonlyMap<string, string>,
): CitationMapping {
  const gapIds: string[] = [];
  let fabricatedRefCount = 0;
  for (const ref of refs) {
    const gapId = gapIdByRef.get(ref);
    if (gapId === undefined) fabricatedRefCount += 1;
    else gapIds.push(gapId);
  }
  return {
    gapIds: fabricatedRefCount === 0 ? gapIds : undefined,
    fabricatedRefCount,
  };
}
