import {
  tokenizeForMatching,
  type GapClassification,
  type GapConfidence,
  type ProfileFactKind,
} from '@careerforge/core';

import { phraseMatches } from '../matching.ts';

// M12-03 (ADR-0021): the durable-profile-fact evaluator. PURE and deterministic
// like the rest of packages/scoring - no clock, no I/O, no LLM. It resolves an
// administrative posting requirement (work authorization, visa sponsorship,
// security clearance) against a DECLARED fact. Facts are informative, NEVER hard
// filters (arc D-4): every outcome here is `satisfied_fact` or `unknown` - a
// fact NEVER produces `genuine_gap` and NEVER excludes a posting (R1). And
// `satisfied_fact` requires a POSITIVE determination, never mere presence (the
// M12-03 review: presence-without-comparison would fabricate a fit conclusion
// and misuse the "deterministic proof" meaning of `high` confidence).
//
// Fact VALUES never appear in the rationale (a sensitive class; the value is
// visible only in the escaped Evidence Library) - rationales cite the fact KIND.

/** Each administrative requirement phrase and the durable-fact KIND it maps to.
 *  ONE source of truth for both the pattern match and the phrase->kind mapping,
 *  so no spelling can map to a kind for one phrasing and not its sibling (the
 *  M12-03 review, correctness#2). `kind: null` = recognized as administrative
 *  but no fact is modeled (background check / drug screen - honestly unmodeled;
 *  these keep the M12-02 `administrative_pattern`/`unknown` behavior). Matched
 *  case-insensitively as PHRASES over the requirement's token stream, so
 *  matching is token-level, never substring ("visualization" never fires
 *  "visa"). */
export const ADMINISTRATIVE_FACT_PATTERNS: readonly {
  phrase: string;
  kind: ProfileFactKind | null;
}[] = [
  { phrase: 'work authorization', kind: 'work_authorization' },
  { phrase: 'authorized to work', kind: 'work_authorization' },
  { phrase: 'authorization to work', kind: 'work_authorization' },
  { phrase: 'citizenship', kind: 'work_authorization' },
  { phrase: 'visa', kind: 'visa_sponsorship_needed' },
  { phrase: 'sponsorship', kind: 'visa_sponsorship_needed' },
  { phrase: 'security clearance', kind: 'security_clearance' },
  { phrase: 'clearance', kind: 'security_clearance' },
  { phrase: 'background check', kind: null },
  { phrase: 'drug screen', kind: null },
  { phrase: 'drug screening', kind: null },
  { phrase: 'drug test', kind: null },
  { phrase: 'drug testing', kind: null },
];

export interface AdministrativeMatch {
  phrase: string;
  kind: ProfileFactKind | null;
}

/** The first administrative pattern the requirement tokens match, or undefined. */
export function matchAdministrative(tokens: readonly string[]): AdministrativeMatch | undefined {
  for (const pattern of ADMINISTRATIVE_FACT_PATTERNS) {
    if (phraseMatches(tokens, tokenizeForMatching(pattern.phrase))) {
      return { phrase: pattern.phrase, kind: pattern.kind };
    }
  }
  return undefined;
}

// Recognized country groups, as alias phrases, used only to corroborate a
// work-authorization value against a requirement's stated country. The bare
// two-letter codes (us, uk, eu) are DELIBERATELY excluded: "us" collides with
// the English pronoun and would read a work-auth requirement's "join us today"
// as the US country group, manufacturing a false conflict or a false satisfy
// (the M12-03 code review). Corroboration therefore keys off spelled-out names
// and national adjectives only; an abbreviation-only requirement or value simply
// yields no country group (=> satisfied_fact/medium, never a false conflict).
// Matched with STRICT adjacency (maxGap 0). Country-precise matching beyond this
// bounded set is a documented ADR-0021 limitation.
const COUNTRY_GROUPS: readonly { key: string; aliases: readonly string[] }[] = [
  { key: 'us', aliases: ['usa', 'united states', 'america', 'american'] },
  { key: 'uk', aliases: ['united kingdom', 'britain', 'british'] },
  { key: 'eu', aliases: ['european union', 'europe', 'european'] },
  { key: 'canada', aliases: ['canada', 'canadian'] },
  { key: 'australia', aliases: ['australia', 'australian'] },
  { key: 'india', aliases: ['india', 'indian'] },
];

function countryGroupsIn(tokens: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (const group of COUNTRY_GROUPS) {
    if (group.aliases.some((alias) => phraseMatches(tokens, tokenizeForMatching(alias), 0))) {
      found.add(group.key);
    }
  }
  return found;
}

// Phrases that AFFIRMATIVELY indicate a posting sponsors visas. TWO layers keep
// a negation from producing a false satisfy (the M12-03 review, blocker#1 and
// its regression): (1) STRICT adjacency (maxGap 0) so a negation BETWEEN the
// tokens breaks the match ("sponsorship not available"); (2) the NEGATION_CUES
// guard below rejects any requirement carrying a negation ANYWHERE, catching the
// negation-BEFORE-verb forms strict adjacency cannot ("we do not offer
// sponsorship", "no sponsorship available"). Affirmative detection, not fragile
// negative detection; unmatched always falls through to `unknown`.
const AFFIRMATIVE_SPONSORSHIP_PHRASES: readonly string[] = [
  'sponsorship available',
  'sponsorship is available',
  'sponsorship offered',
  'sponsorship is offered',
  'sponsorship provided',
  'sponsorship is provided',
  'offer sponsorship',
  'offers sponsorship',
  'provide sponsorship',
  'provides sponsorship',
  'will sponsor',
  'we sponsor',
  'can sponsor',
  'do sponsor',
  'visa sponsorship available',
  'visa sponsorship provided',
  'provide visa sponsorship',
  'provides visa sponsorship',
  'offer visa sponsorship',
  'offers visa sponsorship',
  'h1b sponsorship',
  'h 1b sponsorship',
];

// Negation / inability cues. An affirmative sponsorship phrase can be preceded
// by one of these ("we do not offer sponsorship", "no sponsorship available",
// "unable to provide sponsorship") WITHOUT breaking the phrase's own adjacency,
// so strict-adjacency affirmative matching alone fails OPEN (the M12-03 code
// review, blocker#1 regression). A satisfy therefore ALSO requires that NO
// negation cue appears anywhere in the requirement. Fails toward `unknown`: an
// affirmative posting carrying an incidental "no"/"not" is conservatively left
// `unknown` (needs your input) rather than falsely satisfied.
const NEGATION_CUES = new Set([
  'no',
  'not',
  'never',
  'without',
  'unable',
  'cannot',
  'cant',
  'unless',
  'ineligible',
  'neither',
  'nor',
  'lacking',
  'excluding',
]);

function hasNegationCue(tokens: readonly string[]): boolean {
  return tokens.some((token) => NEGATION_CUES.has(token));
}

/** A posting affirmatively offers sponsorship: an affirmative phrase matches AND
 *  no negation cue is present anywhere (so a preceding negation cannot defeat
 *  the strict-adjacency phrase match). */
function offersSponsorship(requirementTokens: readonly string[]): boolean {
  if (hasNegationCue(requirementTokens)) return false;
  return AFFIRMATIVE_SPONSORSHIP_PHRASES.some((phrase) =>
    phraseMatches(requirementTokens, tokenizeForMatching(phrase), 0),
  );
}

// A declared security_clearance value that indicates NOT holding one.
const CLEARANCE_NEGATIVE_TOKENS = new Set(['none', 'no', 'na', 'nil', 'not', 'unclassified']);

function declaresNoClearance(value: string): boolean {
  const tokens = tokenizeForMatching(value);
  return tokens.length > 0 && tokens.every((token) => CLEARANCE_NEGATIVE_TOKENS.has(token));
}

const KIND_LABELS: Record<ProfileFactKind, string> = {
  work_authorization: 'work authorization',
  visa_sponsorship_needed: 'visa sponsorship',
  relocation_stance: 'relocation preference',
  remote_onsite_stance: 'remote/onsite preference',
  security_clearance: 'security clearance',
  availability_notice: 'availability',
};

export interface DurableFactResult {
  /** Always an evidence-status class - `satisfied_fact` or `unknown`, never a gap. */
  classification: Extract<GapClassification, 'satisfied_fact' | 'unknown'>;
  confidence: GapConfidence;
  rationale: string;
}

/**
 * Classify an administrative requirement (already mapped to `kind`) against the
 * declared fact `value` (undefined = not declared). Deterministic; the caller
 * stamps evaluator `durable_profile_fact`.
 */
export function classifyDurableFact(
  kind: ProfileFactKind,
  requirementTokens: readonly string[],
  value: string | undefined,
): DurableFactResult {
  const label = KIND_LABELS[kind];
  const declareAffordance = `Declare ${kind} in facts.md and re-import to resolve.`;

  if (value === undefined) {
    return {
      classification: 'unknown',
      confidence: 'low',
      rationale: `This posting has a ${label} requirement you have not declared a fact for. ${declareAffordance}`,
    };
  }

  if (kind === 'visa_sponsorship_needed') {
    if (value === 'no') {
      return {
        classification: 'satisfied_fact',
        confidence: 'high',
        rationale:
          'You have indicated you do not require visa sponsorship, so this requirement is met.',
      };
    }
    // value === 'yes' (the only other closed-vocab value).
    if (offersSponsorship(requirementTokens)) {
      return {
        classification: 'satisfied_fact',
        confidence: 'high',
        rationale:
          'You indicated you need visa sponsorship, and this posting states it offers sponsorship - met.',
      };
    }
    return {
      classification: 'unknown',
      confidence: 'low',
      rationale:
        'You indicated you need visa sponsorship; this posting does not clearly state it offers sponsorship. Confirm before applying.',
    };
  }

  if (kind === 'work_authorization') {
    const requirementCountries = countryGroupsIn(requirementTokens);
    const valueCountries = countryGroupsIn(tokenizeForMatching(value));
    const shared = [...requirementCountries].some((country) => valueCountries.has(country));
    if (shared) {
      return {
        classification: 'satisfied_fact',
        confidence: 'high',
        rationale:
          'Your declared work authorization matches the country this posting states, so this requirement is met.',
      };
    }
    if (requirementCountries.size > 0 && valueCountries.size > 0) {
      return {
        classification: 'unknown',
        confidence: 'low',
        rationale:
          'This posting requires work authorization in a country that differs from your declared authorization. Confirm your eligibility.',
      };
    }
    return {
      classification: 'satisfied_fact',
      confidence: 'medium',
      rationale:
        'You have declared work authorization, which addresses this requirement; confirm it covers the specific country this posting states, if any.',
    };
  }

  // security_clearance - never auto-satisfied in v2.1 (level comparison deferred;
  // holding SOME clearance does not prove it meets an arbitrary required level).
  if (declaresNoClearance(value)) {
    return {
      classification: 'unknown',
      confidence: 'low',
      rationale:
        'This posting requires a security clearance; you have declared you do not hold one. Weigh whether to proceed.',
    };
  }
  return {
    classification: 'unknown',
    confidence: 'low',
    rationale:
      'This posting requires a security clearance; you have declared a clearance status. Confirm it meets the required level.',
  };
}

// -- Location-requirement stance enrichment ----------------------------------
// relocation_stance / remote_onsite_stance NEVER enter the gap route; they only
// enrich the location requirement's rationale (D-4 canonical example). They
// never change a classification and never exclude a posting.

const RELOCATION_CLAUSES: Record<string, string> = {
  willing: 'You have said you are willing to relocate.',
  open_for_right_opportunity: 'You have said you would consider relocating for the right role.',
  prefer_not: 'You have said you would prefer not to relocate.',
  no: 'You have said you are not open to relocating.',
};

const REMOTE_CLAUSES: Record<string, string> = {
  remote_only: 'You have said you want remote-only roles.',
  prefer_remote: 'You have said you prefer remote work.',
  flexible: 'You have said you are flexible on remote vs onsite.',
  prefer_onsite: 'You have said you prefer onsite work.',
  onsite_ok: 'You have said you are open to onsite work.',
};

/** A trailing rationale clause for a location requirement, from the declared
 *  relocation/remote stances (either or both may be undefined). Empty when
 *  neither is declared. Leading space so it appends to the base rationale. */
export function locationStanceClause(
  relocation: string | undefined,
  remote: string | undefined,
): string {
  const parts: string[] = [];
  if (relocation !== undefined && RELOCATION_CLAUSES[relocation]) {
    parts.push(RELOCATION_CLAUSES[relocation]);
  }
  if (remote !== undefined && REMOTE_CLAUSES[remote]) {
    parts.push(REMOTE_CLAUSES[remote]);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}
