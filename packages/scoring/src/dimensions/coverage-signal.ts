import {
  tokenizeForMatching,
  type FitDimension,
  type RequirementCategory,
  type SubScore,
} from '@careerforge/core';

import { clamp01, mean, phraseMatches, round4 } from '../matching.ts';
import { coverageOf, type PreparedInput } from '../prepare.ts';

// Shared shape of the `technical` and `domain` dimensions: evidence coverage
// over the dimension's requirement categories, blended 0.8/0.2 with the
// matched share of its positive-signal list. One implementation so the two
// dimensions cannot drift. `matchedSlugs` is THE slug-vs-posting matcher —
// priority and stretch reuse it too.

/** Which of these slugs appear (phrase match, gap 2) in at least one eligible
 *  requirement? Matching is PER REQUIREMENT — a phrase can never assemble
 *  itself across two adjacent requirements' tokens. */
export function matchedSlugs(prepared: PreparedInput, slugs: readonly string[]): string[] {
  const perRequirement = [...prepared.requirementTokens.values()];
  return slugs.filter((slug) => {
    const slugTokens = tokenizeForMatching(slug);
    return perRequirement.some((tokens) => phraseMatches(tokens, slugTokens));
  });
}

export function scoreCoverageWithSignals(options: {
  prepared: PreparedInput;
  dimension: FitDimension;
  categories: readonly RequirementCategory[];
  signalSlugs: readonly string[];
  signalNoun: string;
  emptyRationale: string;
}): SubScore {
  const { prepared, dimension, categories, signalSlugs, signalNoun, emptyRationale } = options;
  const relevant = prepared.eligible.filter((requirement) =>
    categories.includes(requirement.category),
  );
  if (relevant.length === 0) {
    return { dimension, score: 0.5, rationale: emptyRationale, evidence: [] };
  }
  const coverage = round4(
    mean(relevant.map((requirement) => coverageOf(prepared.evidence.get(requirement.id)))),
  );
  const matched = matchedSlugs(prepared, signalSlugs);
  const signalRatio = round4(matched.length / signalSlugs.length);
  const score = round4(clamp01(0.8 * coverage + 0.2 * signalRatio));
  const matchedNote = matched.length === 0 ? '' : ` (${matched.join(', ')})`;
  return {
    dimension,
    score,
    rationale:
      `Evidence coverage ${String(coverage)} across ${String(relevant.length)} ` +
      `${categories.join('/')} requirement(s); ${String(matched.length)} of ` +
      `${String(signalSlugs.length)} preferred ${signalNoun} appear in the posting${matchedNote}.`,
    evidence: relevant.flatMap((requirement) => prepared.evidence.get(requirement.id) ?? []),
  };
}
