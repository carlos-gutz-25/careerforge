import {
  normalizeWhitespace,
  type GapAssignment,
  type GapCarriedVia,
  type GapClassification,
} from '@careerforge/core';

// The pure carry-match core (M1-11 A1, plan rider R2): ONE binding function
// serves both sides — the WRITE path (persistFitReport carries overrides
// onto the new report's rows) and the READ path (findGapsForReport counts
// the prior report's overridden rows that bound to nothing), so read is the
// exact complement of write by construction. The source set is always the
// posting's immediately prior report's user_overridden rows — never older
// history (an un-override can never be resurrected). Content comparison is
// core normalizeWhitespace in JS on already-fetched rows (rider R1) —
// byte-identical M1-06 semantics, never a SQL-side reimplementation.

/** One row of the report being written/rendered: a requirement id and its
 *  requirement's text (posting-derived; used only for equality matching). */
export interface CurrentGapKey {
  requirementId: string;
  requirementText: string;
}

/** A prior report's overridden gap row, with its requirement's text. */
export interface PriorOverriddenGap extends CurrentGapKey {
  classification: GapClassification;
  overrideNote: string | null;
}

export interface GapCarryBinding {
  /** current requirementId -> the prior overridden row it carries, and how. */
  bound: Map<string, { prior: PriorOverriddenGap; via: GapCarriedVia }>;
  /** Prior overridden rows bound to NO current row — the loud orphans. */
  lostOverrides: number;
}

/**
 * Bind prior overridden rows to current rows: requirement_id first (the
 * re-score case), then the D4 one-to-one content match (the re-extraction
 * case) — content-carry fires iff the normalized text is unique among ALL
 * current texts AND unique among ALL prior overridden texts, and that prior
 * row was not already consumed. Any duplication on either side means no
 * carry: ambiguity never guesses.
 */
export function bindPriorOverrides(
  current: readonly CurrentGapKey[],
  priorOverridden: readonly PriorOverriddenGap[],
): GapCarryBinding {
  const bound = new Map<string, { prior: PriorOverriddenGap; via: GapCarriedVia }>();
  const usedPrior = new Set<PriorOverriddenGap>();

  const priorById = new Map(priorOverridden.map((prior) => [prior.requirementId, prior]));
  for (const row of current) {
    const prior = priorById.get(row.requirementId);
    if (prior && !usedPrior.has(prior)) {
      bound.set(row.requirementId, { prior, via: 'requirement_id' });
      usedPrior.add(prior);
    }
  }

  const countByText = (texts: readonly string[]): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1);
    return counts;
  };
  const currentTextCounts = countByText(
    current.map((row) => normalizeWhitespace(row.requirementText)),
  );
  const priorTextCounts = countByText(
    priorOverridden.map((prior) => normalizeWhitespace(prior.requirementText)),
  );
  const priorByText = new Map(
    priorOverridden.map((prior) => [normalizeWhitespace(prior.requirementText), prior]),
  );

  for (const row of current) {
    if (bound.has(row.requirementId)) continue;
    const normalized = normalizeWhitespace(row.requirementText);
    if (currentTextCounts.get(normalized) !== 1 || priorTextCounts.get(normalized) !== 1) continue;
    const prior = priorByText.get(normalized);
    if (!prior || usedPrior.has(prior)) continue;
    bound.set(row.requirementId, { prior, via: 'content' });
    usedPrior.add(prior);
  }

  return { bound, lostOverrides: priorOverridden.length - usedPrior.size };
}

/** The values of one gaps row about to be inserted (persistFitReport). */
export interface ResolvedGapRow {
  requirementId: string;
  classification: GapClassification;
  engineClassification: GapClassification;
  rationale: string;
  userOverridden: boolean;
  overrideNote: string | null;
  carriedVia: GapCarriedVia | null;
}

/**
 * Fresh engine assignments + the binding -> insertable rows. A carried row
 * keeps the FRESH engine_classification and rationale (override drift stays
 * visible); the effective classification, note, and carry audit come from
 * the prior override.
 */
export function resolveGapRows(
  assignments: readonly GapAssignment[],
  binding: GapCarryBinding,
): ResolvedGapRow[] {
  return assignments.map((assignment) => {
    const carried = binding.bound.get(assignment.requirementId);
    if (!carried) {
      return {
        requirementId: assignment.requirementId,
        classification: assignment.classification,
        engineClassification: assignment.classification,
        rationale: assignment.rationale,
        userOverridden: false,
        overrideNote: null,
        carriedVia: null,
      };
    }
    return {
      requirementId: assignment.requirementId,
      classification: carried.prior.classification,
      engineClassification: assignment.classification,
      rationale: assignment.rationale,
      userOverridden: true,
      overrideNote: carried.prior.overrideNote,
      carriedVia: carried.via,
    };
  });
}
