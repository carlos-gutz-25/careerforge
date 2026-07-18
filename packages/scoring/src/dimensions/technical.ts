import { type SubScore } from '@careerforge/core';

import { type PreparedInput } from '../prepare.ts';
import { scoreCoverageWithSignals } from './coverage-signal.ts';

/** technical — coverage over language/framework requirements, blended with
 *  the matched share of positiveSignals.technologies (the D-mapping:
 *  technologies -> technical). Empty relevant input: neutral 0.5 (A6). */
export function scoreTechnical(prepared: PreparedInput): SubScore {
  return scoreCoverageWithSignals({
    prepared,
    dimension: 'technical',
    categories: ['language', 'framework'],
    signalSlugs: prepared.criteria.positiveSignals.technologies,
    signalNoun: 'technologies',
    emptyRationale: 'No language or framework requirements extracted - neutral 0.5.',
  });
}
