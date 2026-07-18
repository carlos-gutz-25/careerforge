import { type ForcedLowest, type SubScore } from '@careerforge/core';

import { clamp01, round4 } from '../matching.ts';
import { type PreparedInput } from '../prepare.ts';
import { matchedSlugs } from './coverage-signal.ts';

// priority — signal density, computed HONESTLY: 0.5 baseline, up with the
// matched share of ALL positive signals, down 0.25 per matched negative
// signal. forceLowestPriority NEVER alters the number (D8/A3 — flag, never
// clamp): the cap rides the ForcedLowest flag plus one rationale sentence,
// and M1-10's ranking consumes the flag.

export function computeForcedLowest(prepared: PreparedInput): ForcedLowest {
  const matched = matchedSlugs(prepared, prepared.criteria.forceLowestPriority.industry);
  return { applied: matched.length > 0, matchedSlugs: matched };
}

export function scorePriority(prepared: PreparedInput, forcedLowest: ForcedLowest): SubScore {
  const positives = [
    ...prepared.criteria.positiveSignals.role,
    ...prepared.criteria.positiveSignals.technologies,
    ...prepared.criteria.positiveSignals.problem_domains,
    ...prepared.criteria.positiveSignals.work_arrangement,
    ...prepared.criteria.positiveSignals.scope,
  ];
  const matchedPositive = matchedSlugs(prepared, positives);
  const matchedNegative = matchedSlugs(prepared, prepared.criteria.negativeSignals);
  const positiveRatio = matchedPositive.length / positives.length;
  const score = round4(clamp01(0.5 + 0.5 * positiveRatio - 0.25 * matchedNegative.length));

  const negativeNote =
    matchedNegative.length === 0
      ? 'no negative signals matched'
      : `negative signals matched (${matchedNegative.join(', ')}; -0.25 each)`;
  const forcedNote = forcedLowest.applied
    ? ` Force-lowest-priority industry matched (${forcedLowest.matchedSlugs.join(', ')}): ` +
      'ranked to the bottom tier, never excluded (M1-08 law); the score above stays the ' +
      'honest signal computation.'
    : '';
  return {
    dimension: 'priority',
    score,
    rationale:
      `${String(matchedPositive.length)} of ${String(positives.length)} positive signals ` +
      `matched; ${negativeNote}.${forcedNote}`,
    evidence: [],
  };
}
