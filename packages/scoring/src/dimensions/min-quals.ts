import { type SubScore } from '@careerforge/core';

import { mean, round4 } from '../matching.ts';
import { coverageOf, type PreparedInput } from '../prepare.ts';

/**
 * min_quals — evidence-weighted coverage of must_have requirements
 * (direct=1, partial=0.5, adjacent=0.25, none=0). Empty relevant input is
 * VACUOUSLY met: 1.0 (pre-registered, A6). The rationale names every unmet
 * must-have by its requirement text so the report reads without a join.
 */
export function scoreMinQuals(prepared: PreparedInput): SubScore {
  const relevant = prepared.eligible.filter((requirement) => requirement.kind === 'must_have');
  if (relevant.length === 0) {
    return {
      dimension: 'min_quals',
      score: 1,
      rationale: 'No must-have requirements extracted - minimum qualifications are vacuously met.',
      evidence: [],
    };
  }
  const coverages = relevant.map((requirement) =>
    coverageOf(prepared.evidence.get(requirement.id)),
  );
  const unmet = relevant.filter((_requirement, index) => coverages[index] === 0);
  const met = relevant.length - unmet.length;
  const score = round4(mean(coverages));
  const unmetText =
    unmet.length === 0 ? 'none' : unmet.map((requirement) => `"${requirement.text}"`).join('; ');
  return {
    dimension: 'min_quals',
    score,
    rationale:
      `${String(met)} of ${String(relevant.length)} must-have requirement(s) have profile ` +
      `evidence (weighted coverage ${String(score)}). Unmet: ${unmetText}.`,
    evidence: relevant.flatMap((requirement) => prepared.evidence.get(requirement.id) ?? []),
  };
}
