import {
  gapAssignmentsSchema,
  tokenizeForMatching,
  type EvidenceLink,
  type FitInput,
  type GapAssignment,
  type ProfileSkill,
  type ScoringRequirement,
} from '@careerforge/core';

import { evaluateSeniorityThreshold } from './evaluators/seniority-threshold.ts';
import { phraseMatches } from './matching.ts';
import { prepareInput, type PreparedInput } from './prepare.ts';

// The deterministic gap classifier (M1-11, category-aware since M12-02). Pure
// like scoreFit: no I/O, no clock, no randomness - the lint and determinism
// walls cover this module. It consumes the SAME FitInput through the SAME
// prepareInput (identical canonicalization and evidence derivation), so
// classifications and scores can never disagree about what the evidence was.
// The result re-parses through gapAssignmentsSchema on the way out - a
// contract-violating assignment is unreturnable (the scoreFit pattern).
//
// M12-02 (F1/F2/F3): classifyRequirement ROUTES ON requirement.category before
// the skill ladder. Administrative categories never ladder through skill
// evidence (F2): seniority is evaluated by the shared numeric threshold the fit
// dimension also consumes (F3), comp/location delegate to their dimensions, and
// administrative `other` requirements (work authorization, clearance, ...) route
// to `unknown` for a durable fact (M12-03). Each assignment names its
// `evaluator` (the audit trail) and a `confidence`.
//
// SKILL LADDER (language/framework/domain/non-administrative other), first match
// wins - the M1-11 spec, UNCHANGED through its first four rungs: have ->
// have_undemonstrated -> needs_refresh -> low_priority. Precedence: the
// have-family and needs_refresh outrank low_priority. Named decisions: no
// lastUsed-threshold recency rule (D9 - `rusty` is the curated staleness
// signal); a learning-level skill is a genuine_gap, never needs_refresh -
// "refresh" would claim past competence that never existed (D11), now an
// EXPLICIT rung (rung 5). M12-02 F1 fix (rung 6): with no positive skill signal
// at all the fall-through is `unknown` (insufficient evidence), NOT
// `genuine_gap` - the engine no longer converts "no evidence found" into a
// confirmed gap. `genuine_gap` for a skill category now requires a positive
// signal (the D11 learning-level match) or an operator override. (This narrows
// D10's old adjacent-only-is-genuine_gap: adjacent-only evidence with no named
// skill is now `unknown` - the adjacent evidence rides the rationale so the
// operator can confirm or dismiss it.)

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

/**
 * Administrative-requirement phrases (M12-02, arc D-6): PLAIN CODE, updatable
 * with no prompt-version ceremony or live-leg spend. Matched case-insensitively
 * as PHRASES over the requirement's token stream (tokenizeForMatching), so
 * matching is token-level, never substring - "visualization" never fires
 * "visa", "concerts" never fires "cert" (pinned negatives). An `other`-category
 * requirement matching any of these routes to `unknown` (administrative_pattern)
 * for a durable profile fact in M12-03, never through the skill ladder.
 */
const ADMINISTRATIVE_PATTERNS: readonly string[] = [
  'work authorization',
  'authorized to work',
  'authorization to work',
  'visa',
  'sponsorship',
  'citizenship',
  'security clearance',
  'clearance',
  'background check',
  'drug screen',
  'drug screening',
  'drug test',
  'drug testing',
];

/** The first administrative phrase the requirement tokens match, or undefined. */
function matchesAdministrativePattern(tokens: readonly string[]): string | undefined {
  for (const pattern of ADMINISTRATIVE_PATTERNS) {
    if (phraseMatches(tokens, tokenizeForMatching(pattern))) return pattern;
  }
  return undefined;
}

/** Seniority routing: the shared numeric threshold (F3), never the skill ladder. */
function classifySeniority(
  requirement: ScoringRequirement,
  prepared: PreparedInput,
): GapAssignment {
  const tokens = prepared.requirementTokens.get(requirement.id) ?? [];
  const threshold = evaluateSeniorityThreshold(
    tokens,
    prepared.experiences,
    prepared.referenceDate,
  );
  if (threshold === undefined) {
    return {
      requirementId: requirement.id,
      classification: 'unknown',
      evaluator: 'seniority_threshold',
      confidence: 'low',
      rationale:
        'Seniority requirement with no stated years threshold to evaluate; assessed by the seniority dimension, not a skill gap.',
    };
  }
  const figures =
    `${String(threshold.demanded)}+ years demanded vs computed professional span ` +
    `~${String(threshold.span)} years as of ${prepared.referenceDate}`;
  if (threshold.satisfied) {
    return {
      requirementId: requirement.id,
      classification: 'satisfied_fact',
      evaluator: 'seniority_threshold',
      confidence: 'high',
      rationale: `Seniority threshold met: ${figures}.`,
    };
  }
  return {
    requirementId: requirement.id,
    classification: 'genuine_gap',
    evaluator: 'seniority_threshold',
    confidence: 'high',
    rationale: `Seniority threshold not met: ${figures}.`,
  };
}

/** The M1-11 skill ladder (language/framework/domain/non-administrative other). */
function classifySkill(
  requirement: ScoringRequirement,
  prepared: PreparedInput,
  skillById: ReadonlyMap<string, ProfileSkill>,
  tokens: readonly string[],
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
  // negativeSignals is canonicalized (sorted) by prepareInput - the matched
  // list order is deterministic. Matching is per requirement, the
  // coverage-signal law.
  const negativeMatches = prepared.criteria.negativeSignals.filter((slug) =>
    phraseMatches(tokens, tokenizeForMatching(slug)),
  );

  // The five frozen classes carry confidence null (additive-only: they keep
  // their exact M1-11 semantics and stay ungraded); the evaluator is the audit.
  if (direct.length > 0 && demonstrated.length > 0) {
    return {
      requirementId: requirement.id,
      classification: 'have',
      evaluator: 'skill_evidence',
      confidence: null,
      rationale: `Named skill (${quoteList(direct)}); demonstrated by ${quoteList(demonstrated)}.`,
    };
  }
  if (direct.length > 0) {
    return {
      requirementId: requirement.id,
      classification: 'have_undemonstrated',
      evaluator: 'skill_evidence',
      confidence: null,
      rationale: `Named skill (${quoteList(direct)}); no project or experience demonstrates it.`,
    };
  }
  if (rusty.length > 0) {
    return {
      requirementId: requirement.id,
      classification: 'needs_refresh',
      evaluator: 'skill_evidence',
      confidence: null,
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
      evaluator: 'skill_evidence',
      confidence: null,
      rationale: `Low priority to close: ${reasons.join(' and ')}.${mitigationNote(demonstrated, learning)}`,
    };
  }
  // Rung 5 (D11): a learning-level skill match is a genuine_gap - "refresh"
  // would claim past competence that never existed. This is the ONLY positive
  // signal that still produces genuine_gap from the ladder.
  if (learning.length > 0) {
    return {
      requirementId: requirement.id,
      classification: 'genuine_gap',
      evaluator: 'skill_evidence',
      confidence: null,
      rationale: `Learning-level skill (${quoteList(learning)}); not yet past competence - a genuine gap to close.${mitigationNote(demonstrated, [])}`,
    };
  }
  // Rung 6 (M12-02 F1): no positive skill signal at all -> unknown (insufficient
  // evidence), never a confirmed gap. Any adjacent evidence rides the rationale
  // so the operator can confirm it (add a skill row) or dismiss it.
  return {
    requirementId: requirement.id,
    classification: 'unknown',
    evaluator: 'skill_evidence',
    confidence: 'low',
    rationale: `Insufficient evidence - nothing links this requirement to the profile either way.${mitigationNote(demonstrated, [])}`,
  };
}

function classifyRequirement(
  requirement: ScoringRequirement,
  prepared: PreparedInput,
  skillById: ReadonlyMap<string, ProfileSkill>,
): GapAssignment {
  // Category routing (M12-02) BEFORE the skill ladder (F2).
  if (requirement.category === 'seniority') {
    return classifySeniority(requirement, prepared);
  }
  if (requirement.category === 'comp' || requirement.category === 'location') {
    return {
      requirementId: requirement.id,
      classification: 'not_applicable',
      evaluator: 'dimension_delegation',
      confidence: 'high',
      rationale:
        requirement.category === 'comp'
          ? 'Compensation requirement - assessed by the comp dimension and your search criteria, not a skill gap.'
          : 'Location/work-arrangement requirement - assessed by your search criteria, not a skill gap.',
    };
  }

  const tokens = prepared.requirementTokens.get(requirement.id) ?? [];

  if (requirement.category === 'other') {
    const administrative = matchesAdministrativePattern(tokens);
    if (administrative !== undefined) {
      return {
        requirementId: requirement.id,
        classification: 'unknown',
        evaluator: 'administrative_pattern',
        confidence: 'low',
        rationale: `Administrative requirement ("${administrative}") - declare a durable profile fact to resolve, not a skill to learn.`,
      };
    }
  }

  return classifySkill(requirement, prepared, skillById, tokens);
}

/**
 * Classify every ELIGIBLE requirement (quoteVerified === true) into one of the
 * eight classifications (category-routed, M12-02), in canonical (position, id)
 * order. Unscored rows (failed_verification / not_yet_verified) produce NO
 * assignment - they are surfaced with verification-state reasons on the fit
 * report instead.
 */
export function classifyGaps(input: FitInput): GapAssignment[] {
  const prepared = prepareInput(input);
  const skillById = new Map(prepared.skills.map((skill) => [skill.id, skill]));
  return gapAssignmentsSchema.parse(
    prepared.eligible.map((requirement) => classifyRequirement(requirement, prepared, skillById)),
  );
}
