import { fitReportDataSchema, type FitInput, type FitReportData } from '@careerforge/core';

import { scoreCompLocation } from './dimensions/comp-location.ts';
import { scoreDomain } from './dimensions/domain.ts';
import { scoreMinQuals } from './dimensions/min-quals.ts';
import { computeForcedLowest, scorePriority } from './dimensions/priority.ts';
import { scoreSeniority } from './dimensions/seniority.ts';
import { scoreStretch } from './dimensions/stretch.ts';
import { scoreTechnical } from './dimensions/technical.ts';
import { evaluateExclusions } from './exclusions.ts';
import { prepareInput } from './prepare.ts';

/**
 * The deterministic fit engine (M1-09). Pure: no I/O, no clock (the reference
 * date is INPUT, from the caller's DB clock), no randomness — enforced by
 * lint, pinned by the property tests. Same input SET -> identical output:
 * prepareInput canonicalizes every array (A4), so caller ordering never
 * matters. The result is parsed through fitReportDataSchema on the way out —
 * the engine cannot return a report that violates its own contract
 * (verdict/exclusions coherence, all seven dimensions exactly once,
 * forced-lowest mirror law).
 *
 * Sub-scores are computed even when excluded: the verdict dominates
 * presentation (M1-10), the breakdown stays informative. No merged overall
 * score exists anywhere — deliberately not computed.
 */
export function scoreFit(input: FitInput): FitReportData {
  const prepared = prepareInput(input);
  const exclusions = evaluateExclusions(prepared);
  const forcedLowest = computeForcedLowest(prepared);
  // FIT_DIMENSIONS order (the contract requires each exactly once).
  const subScores = [
    scoreMinQuals(prepared),
    scoreTechnical(prepared),
    scoreDomain(prepared),
    scoreSeniority(prepared),
    scoreCompLocation(prepared),
    scorePriority(prepared, forcedLowest),
    scoreStretch(prepared),
  ];
  return fitReportDataSchema.parse({
    verdict: exclusions.length > 0 ? 'excluded' : 'scored',
    exclusions,
    subScores,
    unscoredRequirements: prepared.unscored,
    forcedLowestPriority: forcedLowest,
    inputFlagged: prepared.inputFlagged,
  });
}
