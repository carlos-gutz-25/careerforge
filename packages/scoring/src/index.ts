import { MODULE_ID as CORE_MODULE_ID } from '@careerforge/core';

export const MODULE_ID = '@careerforge/scoring';
export const INTERNAL_DEPENDENCIES = [CORE_MODULE_ID];

export { scoreFit } from './score-fit.ts';
export { classifyGaps } from './classify-gaps.ts';
export {
  checkClaimProvenance,
  extractNumericMentions,
  CLAIM_PROVENANCE_LAWS,
  NUMERIC_UNIT_MARKERS,
  type CheckClaimProvenanceInput,
  type ClaimEvidenceOwnerKind,
  type ClaimEvidenceSource,
  type ClaimProvenanceEntities,
  type ClaimProvenanceLaw,
  type ClaimProvenanceResult,
  type ClaimProvenanceViolation,
  type NumericMention,
  type NumericUnit,
} from './claim-provenance.ts';
export { parseCompRange, type CompRange } from './comp-parse.ts';
export { evaluateExclusions } from './exclusions.ts';
export { clamp01, mean, phraseMatches, round4, textMatchesPhrase } from './matching.ts';
export { coverageOf, EVIDENCE_WEIGHTS, prepareInput, type PreparedInput } from './prepare.ts';
export {
  hasFullMasteryEvidence,
  suggestSkillUpgrades,
  type SuggestUpgradesExercise,
  type SuggestUpgradesInput,
  type SuggestUpgradesRequirement,
  type SuggestUpgradesSkill,
} from './suggest-upgrades.ts';
export {
  MIN_COUNTER_PROGRESSED,
  MIN_MATCHED_CELL,
  MIN_RESOLVED_ANALYZABLE,
  MIN_UNMATCHED_CELL,
  suggestCriteriaAdjustments,
  type SuggestCriteriaAdjustmentsInput,
  type SuggestCriteriaAdjustmentsResult,
  type SuggestCriteriaApplication,
  type SuggestCriteriaRequirement,
} from './suggest-criteria-adjustments.ts';
export { demandedYears, professionalSpanYears } from './dimensions/seniority.ts';
