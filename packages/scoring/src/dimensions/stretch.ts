import { tokenizeForMatching, type SubScore } from '@careerforge/core';

import { phraseMatches, round4 } from '../matching.ts';
import { coverageOf, type PreparedInput } from '../prepare.ts';

// stretch — growth headroom over NON-must-have requirements (D4): the share
// that is LEARNABLE-NEAR, i.e. partial/adjacent evidence (0 < coverage < 1)
// or no evidence but inside a positive-signal domain (unmatched-near).
// Direct-met nice_to_have rows are no growth; out-of-reach must_have rows are
// min_quals'/M1-11's business, not stretch. 0 = nothing new; empty relevant
// input = 0 (A6: nothing new means no stretch).

export function scoreStretch(prepared: PreparedInput): SubScore {
  const relevant = prepared.eligible.filter((requirement) => requirement.kind === 'nice_to_have');
  if (relevant.length === 0) {
    return {
      dimension: 'stretch',
      score: 0,
      rationale: 'No nice-to-have requirements extracted - no stretch identified.',
      evidence: [],
    };
  }
  const positives = [
    ...prepared.criteria.positiveSignals.role,
    ...prepared.criteria.positiveSignals.technologies,
    ...prepared.criteria.positiveSignals.problem_domains,
    ...prepared.criteria.positiveSignals.work_arrangement,
    ...prepared.criteria.positiveSignals.scope,
  ];
  const nearReach = relevant.filter((requirement) => {
    const coverage = coverageOf(prepared.evidence.get(requirement.id));
    if (coverage > 0 && coverage < 1) return true;
    if (coverage !== 0) return false;
    const tokens = prepared.requirementTokens.get(requirement.id) ?? [];
    return positives.some((slug) => phraseMatches(tokens, tokenizeForMatching(slug)));
  });
  const score = round4(nearReach.length / relevant.length);
  const named =
    nearReach.length === 0
      ? 'none'
      : nearReach.map((requirement) => `"${requirement.text}"`).join('; ');
  return {
    dimension: 'stretch',
    score,
    rationale:
      `${String(nearReach.length)} of ${String(relevant.length)} nice-to-have requirement(s) ` +
      `are learnable-near growth: ${named}.`,
    evidence: nearReach.flatMap((requirement) =>
      (prepared.evidence.get(requirement.id) ?? []).filter((link) => link.strength !== 'direct'),
    ),
  };
}
