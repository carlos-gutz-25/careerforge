import { type SubScore } from '@careerforge/core';

import { parseCompRange, type CompRange } from '../comp-parse.ts';
import { mean, round4 } from '../matching.ts';
import { type PreparedInput } from '../prepare.ts';
import { matchedSlugs } from './coverage-signal.ts';

// comp_location — two legs averaged: parsed compensation vs the PREFERRED
// ranges (compBounds is preferences ONLY; the hard floor lives solely in
// exclude_when and is evaluated by exclusions.ts, never here — single source
// of truth), and location requirements vs work_arrangement signals. No comp
// info in the posting is an AC edge: neutral leg, stated rationale, NEVER an
// exclusion.

/** Three-way comp leg (explainable over clever): entirely below preferred
 *  min = 0, straddling it = 0.5, at/within/above = 1 (higher-than-preferred
 *  pay is not a worse fit). */
function compLegScore(parsed: CompRange, preferredMin: number): number {
  if (parsed.max < preferredMin) return 0;
  if (parsed.min >= preferredMin) return 1;
  return 0.5;
}

export function scoreCompLocation(prepared: PreparedInput): SubScore {
  const compReqs = prepared.eligible.filter((requirement) => requirement.category === 'comp');
  const locationReqs = prepared.eligible.filter(
    (requirement) => requirement.category === 'location',
  );
  const bounds = prepared.criteria.compBounds;

  let compLeg = 0.5;
  let compNote = 'no compensation information in the posting - neutral 0.5';
  for (const requirement of compReqs) {
    const parsed = parseCompRange(`${requirement.text} ${requirement.sourceQuote}`);
    if (!parsed) continue;
    compLeg = compLegScore(parsed, bounds.base_preferred_min);
    compNote =
      `posting base ${String(parsed.min)}-${String(parsed.max)} vs preferred ` +
      `${String(bounds.base_preferred_min)}-${String(bounds.base_preferred_max)} -> ${String(compLeg)}`;
    break; // first parseable comp requirement (canonical order) decides
  }
  if (compReqs.length === 0) {
    compNote = 'no comp requirements extracted - neutral 0.5';
  }

  const arrangement = prepared.criteria.positiveSignals.work_arrangement;
  let locationLeg = 0.5;
  let locationNote = 'no location requirements extracted - neutral 0.5';
  if (locationReqs.length > 0) {
    const matched = matchedSlugs(prepared, arrangement);
    locationLeg = round4(0.5 + 0.5 * (matched.length / arrangement.length));
    locationNote =
      `${String(matched.length)} of ${String(arrangement.length)} work-arrangement ` +
      `signals matched across ${String(locationReqs.length)} location requirement(s)` +
      (matched.length > 0 ? ` (${matched.join(', ')})` : '');
  }

  return {
    dimension: 'comp_location',
    score: round4(mean([compLeg, locationLeg])),
    rationale: `Comp leg: ${compNote}. Location leg: ${locationNote}.`,
    evidence: [],
  };
}
