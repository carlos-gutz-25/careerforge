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
export {
  demandedYears,
  evaluateSeniorityThreshold,
  professionalSpanYears,
  type SeniorityThreshold,
} from './evaluators/seniority-threshold.ts';
export {
  scoreAtsCoverage,
  ATS_COVERAGE_SCORER_VERSION,
  ATS_COVERAGE_HONESTY,
  ATS_COVERAGE_HIT_RATIO,
  ATS_COVERAGE_EVIDENCE_MAX,
  ATS_COVERAGE_STOPWORDS,
  KEYWORD_STUFFING_MIN_COUNT,
  KEYWORD_STUFFING_DENSITY_MAX,
  LENGTH_TOTAL_SHORT_WORDS,
  LENGTH_TOTAL_LONG_WORDS,
  LENGTH_SUMMARY_HEAVY_SHARE,
  LENGTH_SKILLS_HEAVY_SHARE,
  ATS_MISS_SUGGESTION_PREFIX,
  ATS_MISS_SUGGESTION_SUFFIX,
  ATS_PARTIAL_SUGGESTION_PREFIX,
  ATS_PARTIAL_SUGGESTION_SUFFIX,
  type AtsRequirementInput,
  type AtsCoverageResult,
} from './ats-coverage.ts';
export {
  aggregateMarketSignal,
  MARKET_SIGNAL_SCORER_VERSION,
  MARKET_SIGNAL_HONESTY,
  CERTIFICATION_TERMS,
  CERTIFY_MIN_POSTINGS,
  BUCKET_SEVERITY,
  type MarketSignalInstance,
  type MarketSignalRef,
  type MarketSignalCertification,
  type MarketSignalClassificationCounts,
  type MarketSignalGroup,
  type MarketSignalNoActionReason,
  type MarketSignalNoActionGroup,
  type MarketSignalBuckets,
  type MarketSignalResult,
} from './market-signal.ts';
