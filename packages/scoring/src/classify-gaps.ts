import {
  gapAssignmentsSchema,
  tokenizeForMatching,
  type EvidenceLink,
  type FitInput,
  type GapAssignment,
  type ProfileSkill,
  type ScoringRequirement,
} from '@careerforge/core';

import { phraseMatches } from './matching.ts';
import { prepareInput, type PreparedInput } from './prepare.ts';

// The deterministic gap classifier (M1-11). Pure like scoreFit: no I/O, no
// clock, no randomness — the lint and determinism walls cover this module.
// It consumes the SAME FitInput through the SAME prepareInput (identical
// canonicalization and evidence derivation), so classifications and scores
// can never disagree about what the evidence was. The result re-parses
// through gapAssignmentsSchema on the way out — a contract-violating
// assignment is unreturnable (the scoreFit pattern).
//
// LADDER ORDER IS THE SPEC (first match wins), pre-registered at the plan
// gate: have -> have_undemonstrated -> needs_refresh -> low_priority ->
// genuine_gap. Precedence: the have-family and needs_refresh outrank
// low_priority — if you HAVE it, saying so is more informative than
// deprioritizing it; the nice-to-have/negative-signal fact still lands in
// the rationale. Named decisions: no lastUsed-threshold recency rule (D9 —
// `rusty` is the curated staleness signal); adjacent-only evidence is a
// genuine_gap, never a claim of having (D10); a learning-level skill is a
// genuine_gap, never needs_refresh — "refresh" would claim past competence
// that never existed (D11).

function quoteList(links: readonly EvidenceLink[]): string {
  return links.map((link) => link.profileQuote).join('; ');
}

/**
 * R4/rung-5 mitigation note: any adjacent or in-progress evidence present is
 * NAMED in the rationale of the two no-claim buckets (low_priority,
 * genuine_gap) — mitigation visibility is parity across both.
 */
function mitigationNote(
  demonstrated: readonly EvidenceLink[],
  learning: readonly EvidenceLink[],
): string {
  const parts: string[] = [];
  if (demonstrated.length > 0) {
    parts.push(
      ` Adjacent evidence exists (${quoteList(demonstrated)}) but no named skill claims it.`,
    );
  }
  if (learning.length > 0) {
    parts.push(` In-progress skill (${quoteList(learning)}): learning, not yet past competence.`);
  }
  return parts.join('');
}

function classifyRequirement(
  requirement: ScoringRequirement,
  prepared: PreparedInput,
  skillById: ReadonlyMap<string, ProfileSkill>,
): GapAssignment {
  const links = prepared.evidence.get(requirement.id) ?? [];
  const direct = links.filter((link) => link.strength === 'direct');
  const partial = links.filter((link) => link.strength === 'partial');
  // Adjacent links are project/experience-derived by the strength law.
  const demonstrated = links.filter(
    (link) => link.profileProjectId !== null || link.profileExperienceId !== null,
  );
  const levelOf = (link: EvidenceLink): ProfileSkill['level'] | undefined =>
    link.profileSkillId !== null ? skillById.get(link.profileSkillId)?.level : undefined;
  const rusty = partial.filter((link) => levelOf(link) === 'rusty');
  const learning = partial.filter((link) => levelOf(link) === 'learning');
  const tokens = prepared.requirementTokens.get(requirement.id) ?? [];
  // negativeSignals is canonicalized (sorted) by prepareInput — the matched
  // list order is deterministic. Matching is per requirement, the
  // coverage-signal law.
  const negativeMatches = prepared.criteria.negativeSignals.filter((slug) =>
    phraseMatches(tokens, tokenizeForMatching(slug)),
  );

  if (direct.length > 0 && demonstrated.length > 0) {
    return {
      requirementId: requirement.id,
      classification: 'have',
      rationale: `Named skill (${quoteList(direct)}); demonstrated by ${quoteList(demonstrated)}.`,
    };
  }
  if (direct.length > 0) {
    return {
      requirementId: requirement.id,
      classification: 'have_undemonstrated',
      rationale: `Named skill (${quoteList(direct)}); no project or experience demonstrates it.`,
    };
  }
  if (rusty.length > 0) {
    return {
      requirementId: requirement.id,
      classification: 'needs_refresh',
      rationale: `Rusty skill (${quoteList(rusty)}); past competence, refreshable.`,
    };
  }
  if (requirement.kind === 'nice_to_have' || negativeMatches.length > 0) {
    const reasons: string[] = [];
    if (requirement.kind === 'nice_to_have') reasons.push('the posting marks it nice-to-have');
    if (negativeMatches.length > 0) {
      reasons.push(`it matches negative signal(s): ${negativeMatches.join(', ')}`);
    }
    return {
      requirementId: requirement.id,
      classification: 'low_priority',
      rationale: `Low priority to close: ${reasons.join(' and ')}.${mitigationNote(demonstrated, learning)}`,
    };
  }
  return {
    requirementId: requirement.id,
    classification: 'genuine_gap',
    rationale: `No named-skill evidence.${mitigationNote(demonstrated, learning)}`,
  };
}

/**
 * Classify every ELIGIBLE requirement (quoteVerified === true) into one of
 * the five buckets, in canonical (position, id) order. Unscored rows
 * (failed_verification / not_yet_verified) produce NO assignment — they are
 * surfaced with verification-state reasons on the fit report instead.
 */
export function classifyGaps(input: FitInput): GapAssignment[] {
  const prepared = prepareInput(input);
  const skillById = new Map(prepared.skills.map((skill) => [skill.id, skill]));
  return gapAssignmentsSchema.parse(
    prepared.eligible.map((requirement) => classifyRequirement(requirement, prepared, skillById)),
  );
}
