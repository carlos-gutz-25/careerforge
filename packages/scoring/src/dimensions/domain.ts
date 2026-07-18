import { type SubScore } from '@careerforge/core';

import { type PreparedInput } from '../prepare.ts';
import { scoreCoverageWithSignals } from './coverage-signal.ts';

/** domain — coverage over domain-category requirements, blended with the
 *  matched share of positiveSignals.problem_domains (the D-mapping:
 *  problem_domains -> domain). Empty relevant input: neutral 0.5 (A6). */
export function scoreDomain(prepared: PreparedInput): SubScore {
  return scoreCoverageWithSignals({
    prepared,
    dimension: 'domain',
    categories: ['domain'],
    signalSlugs: prepared.criteria.positiveSignals.problem_domains,
    signalNoun: 'problem domains',
    emptyRationale: 'No domain requirements extracted - neutral 0.5.',
  });
}
