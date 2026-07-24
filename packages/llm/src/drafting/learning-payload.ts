import {
  normalizeWhitespace,
  type EvidenceStrength,
  type GapClassification,
  type RequirementCategory,
  type RequirementKind,
  type SkillLevel,
} from '@careerforge/core';

// The learning-plan drafting payload builder (M3-01 §3): pure data-in/
// string-out — no DB, no provider, no clock. The ONE serialization site for
// what a learning-plan drafting call may see (ADR-0005 §3: verified structured
// data only; the strings inside are posting/profile-DERIVED and therefore
// untrusted — the whole document enters the call solely as runPrompt's
// untrustedData, inside the random boundary markers). Gaps are keyed by short
// synthetic refs (g1, g2, …), not UUIDs: the model cites a ref, the server
// maps it back (mapCitedRefs, reused from ./payload.ts) — no id transcription
// surface, fewer tokens.
//
// The one M3-01-specific transform: SYNTACTIC recurrence ranking. A gap is
// "recurring" when the SAME normalizeWhitespace(requirementText) appears in >=2
// DISTINCT source postings among the SELECTED set. This is deterministic and
// never the model's judgment (module boundary: ranking stays out of the LLM).
// Eligible gaps are sorted by (seenInNPostings desc, input order) and the model
// is instructed to keep recurring gaps first; each gap carries its
// seenInNPostings count. N instances of a recurring requirement stay N separate
// gaps (each its own ref) — never merged (the ratified residual).

export interface LearningSkillInput {
  name: string;
  level: SkillLevel;
}

export interface LearningGapInput {
  gapId: string;
  /** EFFECTIVE classification (overrides respected — every selected gap's
   *  source report is reviewed, so this is the post-review value). */
  classification: GapClassification;
  requirementId: string;
  /** The gap's source fit report — the composite evidence key with
   *  requirementId (no cross-report evidence bleed). */
  fitReportId: string;
  /** The gap's source posting — the DISTINCT-postings recurrence key. */
  postingId: string;
  requirementText: string;
  requirementKind: RequirementKind;
  requirementCategory: RequirementCategory;
  rationale: string;
}

export interface LearningEvidenceInput {
  /** Matched to a gap by (fitReportId, requirementId), never requirementId
   *  alone — a selection may span re-scores of one posting. */
  fitReportId: string;
  requirementId: string;
  strength: EvidenceStrength;
  postingQuote: string;
  profileQuote: string;
}

/** Evidence quotes per gap are capped: enough to ground a focus, bounded token
 *  cost (the improvement-plan EVIDENCE_PER_GAP_CAP precedent). */
export const LEARNING_EVIDENCE_PER_GAP_CAP = 3;

export interface LearningPayload {
  /** The JSON document handed to runPrompt as untrustedData. */
  payload: string;
  /** ref (g1…) → gap id: the citation-validation map (mapCitedRefs). */
  gapIdByRef: ReadonlyMap<string, string>;
  /** Eligible (non-'have') gaps included — 0 means nothing to draft (the
   *  service 409s BEFORE any paid call). */
  eligibleGapCount: number;
}

/** Composite evidence key: a gap only ever sees evidence from ITS OWN report. */
function evidenceKey(fitReportId: string, requirementId: string): string {
  return `${fitReportId}::${requirementId}`;
}

/**
 * Builds the learning-plan drafting payload from verified structured inputs.
 * 'have' gaps are excluded (nothing to learn). Recurrence is computed over the
 * ELIGIBLE set: gaps sharing a normalizeWhitespace(requirementText) key
 * contribute their DISTINCT postingIds; a gap's seenInNPostings is that group's
 * distinct-posting count (>=1). Eligible gaps are then ordered by
 * (seenInNPostings desc, input order) and refs g1..gN assigned in that order, so
 * recurring gaps lead. Evidence attaches per gap by (fitReportId, requirementId),
 * capped at LEARNING_EVIDENCE_PER_GAP_CAP.
 *
 * READ-ONLY BORROWER of normalizeWhitespace: that function is the ADR-0006
 * verbatim quote-verification security contract ("must never loosen"). Recurrence
 * only READS it — reusing the verbatim (case- and punctuation-sensitive)
 * normalizer keeps recurrence conservative, so it can only UNDER-count, never
 * overclaim. If recurrence semantics ever need loosening (e.g. case-insensitive),
 * fork a NEW normalizer (the normalizeForMatching split is the precedent) —
 * NEVER edit normalizeWhitespace (ADR-0013).
 */
export function buildLearningPayload(
  skills: readonly LearningSkillInput[],
  gaps: readonly LearningGapInput[],
  evidence: readonly LearningEvidenceInput[],
): LearningPayload {
  const eligible = gaps.filter((gap) => gap.classification !== 'have');

  // Recurrence: normalized requirement text -> the distinct postings it spans.
  const postingsByKey = new Map<string, Set<string>>();
  for (const gap of eligible) {
    const key = normalizeWhitespace(gap.requirementText);
    const bucket = postingsByKey.get(key);
    if (bucket) bucket.add(gap.postingId);
    else postingsByKey.set(key, new Set([gap.postingId]));
  }
  const seenInNPostings = (gap: LearningGapInput): number =>
    postingsByKey.get(normalizeWhitespace(gap.requirementText))?.size ?? 1;

  // Stable rank: recurring gaps first, ties keep input order (deterministic —
  // the repository returns (created_at, id) order).
  const ranked = eligible
    .map((gap, index) => ({ gap, index, recurrence: seenInNPostings(gap) }))
    .sort((a, b) => b.recurrence - a.recurrence || a.index - b.index);

  const evidenceByKey = new Map<string, LearningEvidenceInput[]>();
  for (const link of evidence) {
    const key = evidenceKey(link.fitReportId, link.requirementId);
    const bucket = evidenceByKey.get(key);
    if (bucket) bucket.push(link);
    else evidenceByKey.set(key, [link]);
  }

  const gapIdByRef = new Map<string, string>();
  const gapsJson = ranked.map(({ gap, recurrence }, position) => {
    const ref = `g${String(position + 1)}`;
    gapIdByRef.set(ref, gap.gapId);
    return {
      ref,
      classification: gap.classification,
      kind: gap.requirementKind,
      category: gap.requirementCategory,
      requirement: gap.requirementText,
      rationale: gap.rationale,
      seenInNPostings: recurrence,
      evidence: (evidenceByKey.get(evidenceKey(gap.fitReportId, gap.requirementId)) ?? [])
        .slice(0, LEARNING_EVIDENCE_PER_GAP_CAP)
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
