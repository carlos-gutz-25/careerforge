import { MODULE_ID as CORE_MODULE_ID } from '@careerforge/core';

export const MODULE_ID = '@careerforge/scoring';
export const INTERNAL_DEPENDENCIES = [CORE_MODULE_ID];

export { scoreFit } from './score-fit.ts';
export { classifyGaps } from './classify-gaps.ts';
export { parseCompRange, type CompRange } from './comp-parse.ts';
export { evaluateExclusions } from './exclusions.ts';
export { clamp01, mean, phraseMatches, round4, textMatchesPhrase } from './matching.ts';
export { coverageOf, EVIDENCE_WEIGHTS, prepareInput, type PreparedInput } from './prepare.ts';
export { demandedYears, professionalSpanYears } from './dimensions/seniority.ts';
