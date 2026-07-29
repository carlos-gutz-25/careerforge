import {
  GAP_DISCLOSURE_REQUIRED_CLASSIFICATIONS,
  isEvidenceStatusClassification,
  type EvidenceStrength,
  type GapClassification,
  type RequirementCategory,
  type RequirementKind,
  type SkillLevel,
} from '@careerforge/core';

// The interview-prep drafting payload builder (M3-04 §2): pure data-in/
// string-out — no DB, no provider, no clock. The ONE serialization site for
// what an interview-prep drafting call may see (ADR-0005 §3: verified
// structured data only; the strings inside are posting/profile-DERIVED and
// therefore untrusted — the whole document enters the call solely as
// runPrompt's untrustedData, inside the random boundary markers). Raw posting
// text never re-enters an LLM call.
//
// Refs: requirements r1..rN, evidence e1..eM (global numbering, assigned in
// requirement order) — the model cites refs, the server maps them back (no id
// transcription surface). GAPS CARRY NO REFS (the M3-04 design pin): the
// model never addresses a gap directly; a requirement's gap identity rides on
// the requirement itself and the server resolves the gap id + classification
// structurally from gapByRequirementRef — zero fabrication surface for gaps.

export interface InterviewSkillInput {
  name: string;
  level: SkillLevel;
}

export interface InterviewRequirementInput {
  requirementId: string;
  /** M1-06 tristate. ONLY `=== true` enters the payload (gate condition 1):
   *  `false` failed verification, `null` was never verified — both are
   *  excluded and counted, never sent. */
  quoteVerified: boolean | null;
  text: string;
  kind: RequirementKind;
  category: RequirementCategory;
  /** The requirement's gap row on THIS report, if any. Gap is 1:0..1 per
   *  (report, requirement); ABSENT means no classification exists — no
   *  disclosure obligation, and NOT "non-have" (gate condition 2). The
   *  classification is the EFFECTIVE (post-review) value. */
  gap: { gapId: string; classification: GapClassification } | null;
}

export interface InterviewEvidenceInput {
  evidenceLinkId: string;
  /** Evidence attaches to its requirement WITHIN the report the service
   *  loaded — single-report scope, so requirementId alone is the key (the
   *  M1-12 precedent, not the cross-report learning composite). */
  requirementId: string;
  strength: EvidenceStrength;
  postingQuote: string;
  profileQuote: string;
}

/** Evidence quotes per requirement are capped: enough to ground a talking
 *  point, bounded token cost (the EVIDENCE_PER_GAP_CAP family precedent). */
export const INTERVIEW_EVIDENCE_PER_REQUIREMENT_CAP = 3;

/** An e-ref's resolution: the link id AND its owning requirement's ref — the
 *  cross-requirement-bleed half of the citation tripwire keys on the pair. */
export interface InterviewEvidenceRef {
  evidenceLinkId: string;
  requirementRef: string;
}

export interface InterviewPayload {
  /** The JSON document handed to runPrompt as untrustedData. */
  payload: string;
  /** ref (r1…) → requirement id: citation validation (mapCitedRefs-style). */
  requirementIdByRef: ReadonlyMap<string, string>;
  /** ref (e1…) → link id + owning requirement ref: citation validation AND
   *  the no-cross-requirement-bleed check. */
  evidenceByRef: ReadonlyMap<string, InterviewEvidenceRef>;
  /** requirement ref → its gap (id + effective classification), for refs
   *  that HAVE a gap row — the server-side gap resolution map. */
  gapByRequirementRef: ReadonlyMap<string, { gapId: string; classification: GapClassification }>;
  /** Requirement refs whose gap classification OBLIGES a gap_disclosure on
   *  every question addressing them (the disclosure-tripwire input set). */
  disclosureRequiredRefs: ReadonlySet<string>;
  /** Verified (=== true) requirements included — 0 means nothing to draft
   *  (the service 409s BEFORE any paid call). */
  verifiedRequirementCount: number;
  /** Requirements excluded by the strict filter (false OR null) — value-free
   *  route-log telemetry, never sent anywhere. */
  excludedRequirementCount: number;
}

const DISCLOSURE_REQUIRED = new Set<GapClassification>(GAP_DISCLOSURE_REQUIRED_CLASSIFICATIONS);

/**
 * Builds the interview-prep drafting payload from verified structured inputs.
 * The verified filter is STRICT `=== true` (gate condition 1). Refs r1..rN
 * number the verified requirements in input order (the repository returns
 * (position, id) order); evidence attaches per requirement by requirementId,
 * capped at INTERVIEW_EVIDENCE_PER_REQUIREMENT_CAP, with e-refs numbered
 * globally in requirement order. A requirement's gap classification is
 * serialized inline on the requirement WHEN a gap row exists; a no-gap-row
 * requirement serializes without the field (gate condition 2). Evidence for
 * excluded requirements is dropped entirely — nothing of theirs reaches the
 * payload.
 */
export function buildInterviewPayload(
  skills: readonly InterviewSkillInput[],
  requirements: readonly InterviewRequirementInput[],
  evidence: readonly InterviewEvidenceInput[],
): InterviewPayload {
  const verified = requirements.filter((requirement) => requirement.quoteVerified === true);

  const evidenceByRequirement = new Map<string, InterviewEvidenceInput[]>();
  for (const link of evidence) {
    const bucket = evidenceByRequirement.get(link.requirementId);
    if (bucket) bucket.push(link);
    else evidenceByRequirement.set(link.requirementId, [link]);
  }

  const requirementIdByRef = new Map<string, string>();
  const evidenceByRef = new Map<string, InterviewEvidenceRef>();
  const gapByRequirementRef = new Map<
    string,
    { gapId: string; classification: GapClassification }
  >();
  const disclosureRequiredRefs = new Set<string>();

  let evidenceCounter = 0;
  const requirementsJson = verified.map((requirement, index) => {
    const ref = `r${String(index + 1)}`;
    requirementIdByRef.set(ref, requirement.requirementId);
    // M12-02: the evidence-status classes (unknown/satisfied_fact/not_applicable)
    // are not skill gaps - the LLM sees NO gap for them (the requirement still
    // serializes; the prompt vocabulary is unchanged, arc R-2).
    const draftableGap =
      requirement.gap && !isEvidenceStatusClassification(requirement.gap.classification)
        ? requirement.gap
        : undefined;
    if (draftableGap) {
      gapByRequirementRef.set(ref, draftableGap);
      if (DISCLOSURE_REQUIRED.has(draftableGap.classification)) {
        disclosureRequiredRefs.add(ref);
      }
    }
    const links = (evidenceByRequirement.get(requirement.requirementId) ?? []).slice(
      0,
      INTERVIEW_EVIDENCE_PER_REQUIREMENT_CAP,
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
      // Absent field (not null) when no gap row exists — the model sees a
      // classification only where one actually exists.
      ...(draftableGap ? { gapClassification: draftableGap.classification } : {}),
      evidence: evidenceJson,
    };
  });

  const payload = JSON.stringify(
    {
      profileSkills: skills.map((skill) => ({ name: skill.name, level: skill.level })),
      requirements: requirementsJson,
    },
    null,
    2,
  );

  return {
    payload,
    requirementIdByRef,
    evidenceByRef,
    gapByRequirementRef,
    disclosureRequiredRefs,
    verifiedRequirementCount: verified.length,
    excludedRequirementCount: requirements.length - verified.length,
  };
}
