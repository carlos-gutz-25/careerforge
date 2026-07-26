import {
  APPLICATION_STAGE_RANKS,
  PROGRESSED_MIN_RANK,
  SIGNAL_CATEGORIES,
  applicationStageSchema,
  furthestRankedStage,
  parseStageChangeDetail,
  tokenizeForMatching,
  CRITERIA_ADJUSTMENT_KINDS,
  type ApplicationStage,
  type CriteriaAdjustmentPosting,
  type CriteriaAdjustmentSuggestion,
  type CriteriaSuggestionStatus,
  type CriteriaSuggestionTotals,
  type SearchCriteriaData,
  type SignalCategory,
} from '@careerforge/core';

import { phraseMatches } from './matching.ts';

// M4-02 — deterministic criteria-adjustment suggestions (Outcomes → matching
// feedback). PURE like scoreFit/classifyGaps/suggestSkillUpgrades: no I/O, no
// clock, no randomness. The api service assembles the inputs (the user's current
// criteria + their applications with stage trails and each posting's eligible
// requirements) and this function derives which slugs the outcome data argues to
// REMOVE. Nothing is stored; the api recomputes per request (GET) and re-derives
// at confirm time (POST) from this one definition — the "never trust the client"
// spine (the M3-06 / M4-01 re-derivation lineage).
//
// This is the SECOND consumer of matching.ts (phraseMatches / tokenizeForMatching)
// outside the fit engine (suggest-upgrades.ts is the first) — borrowed READ-ONLY.
// If the matcher's semantics are ever loosened for the fit engine's needs, fork a
// private copy here rather than let a fit-engine tuning silently shift which
// adjustments get suggested (the M3-01 normalizeWhitespace-borrow precedent).
//
// Inherited residual, DOCUMENTED not fixed (RATIFIED disposition, per the
// "every finding gets a disposition" rule): phraseMatches has NO stopword list,
// so a one-token slug like `go`, `r`, or `ai` matches incidental words in
// requirement text (identical to M1-09 fit evidence and M3-06 upgrades). UNLIKE
// M3-06 — where a false match only inflated one skill's backing exercise list, a
// per-suggestion detail — here a false match distorts the AGGREGATE 2×2 cohort
// that drives the whole trigger. The mitigation is structural, not algorithmic:
// every suggestion enumerates its matched applications in `matchedPostings`, and
// the human confirmation gate is the only spot-check. Precedent-consistent with
// M1-09/M3-06; a stopword list is a recorded future item, not this story.

/** Strict 2×2 comparison-group triggers (RATIFIED OD-1). Integer arithmetic
 *  only — rate comparisons use cross-multiplication, never floats. */
export const MIN_RESOLVED_ANALYZABLE = 8;
export const MIN_MATCHED_CELL = 4;
export const MIN_UNMATCHED_CELL = 4;
export const MIN_COUNTER_PROGRESSED = 2;

/** Stages that count as "exposed to the market" (past mere consideration). A
 *  rejection IS an exposure — the posting was seen and acted on. */
const EXPOSED_STAGES: ReadonlySet<ApplicationStage> = new Set<ApplicationStage>([
  'applied',
  'screen',
  'interview',
  'offer',
  'rejected',
]);

export interface SuggestCriteriaRequirement {
  /** Requirement text — part of the phrase-match haystack (never persisted). */
  text: string;
  /** The posting quote backing the requirement — the rest of the haystack,
   *  mirroring the fit engine (prepare.ts) and suggest-upgrades. */
  sourceQuote: string;
}

export interface SuggestCriteriaApplication {
  applicationId: string;
  postingId: string;
  /** User-curated posting metadata — surfaced in evidence (escaped on display). */
  company: string | null;
  title: string | null;
  /** ISO YYYY-MM-DD or null; the matchedPostings tiebreak sorts on it (nulls last). */
  appliedOn: string | null;
  currentStage: ApplicationStage;
  /** stage_change event details, chronological, format `${from} → ${to}`. */
  stageTrail: string[];
  /** The posting's latest requirement-bearing run's ELIGIBLE (quoteVerified)
   *  requirements — or null when there is no such run (resolved-but-unextracted,
   *  disclosed as `withoutRequirements`, never in a denominator). */
  requirements: SuggestCriteriaRequirement[] | null;
}

export interface SuggestCriteriaAdjustmentsInput {
  criteria: SearchCriteriaData;
  applications: SuggestCriteriaApplication[];
}

export interface SuggestCriteriaAdjustmentsResult {
  status: CriteriaSuggestionStatus;
  totals: CriteriaSuggestionTotals;
  suggestions: CriteriaAdjustmentSuggestion[];
}

/** One analyzed application: its derived stage facts + the candidate slugs its
 *  eligible requirements matched. Only `analyzable` apps reach the 2×2. */
interface AnalyzedApplication {
  app: SuggestCriteriaApplication;
  progressed: boolean;
  furthestStage: ApplicationStage;
  /** Candidate slug strings this application's requirements phrase-matched. */
  matchedSlugs: ReadonlySet<string>;
}

/** The stage set for one application: its current stage plus both sides of every
 *  stage_change detail that zod-parses as a stage. */
function stagesOf(app: SuggestCriteriaApplication): Set<ApplicationStage> {
  const stages = new Set<ApplicationStage>([app.currentStage]);
  for (const detail of app.stageTrail) {
    const parsed = parseStageChangeDetail(detail);
    if (!parsed) continue;
    for (const side of [parsed.from, parsed.to]) {
      const result = applicationStageSchema.safeParse(side);
      if (result.success) stages.add(result.data);
    }
  }
  return stages;
}

/** Does any eligible requirement phrase-match the slug? (Fit-engine semantics,
 *  byte-for-byte: `phraseMatches(tokens(text + ' ' + quote), tokens(slug))`.) */
function requirementsMatchSlug(
  requirements: SuggestCriteriaRequirement[],
  slugTokens: readonly string[],
): boolean {
  for (const requirement of requirements) {
    if (
      phraseMatches(
        tokenizeForMatching(`${requirement.text} ${requirement.sourceQuote}`),
        slugTokens,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Every distinct slug across positive (all categories) + negative signals — the
 *  candidate universe, from CURRENT criteria only (closed-vocabulary law). */
function candidateSlugUniverse(criteria: SearchCriteriaData): string[] {
  const seen = new Set<string>();
  for (const category of SIGNAL_CATEGORIES) {
    for (const slug of criteria.positiveSignals[category]) seen.add(slug);
  }
  for (const slug of criteria.negativeSignals) seen.add(slug);
  return [...seen];
}

/** The determinism law: (kind per array order, category asc nulls-last, slug asc). */
function compareSuggestions(
  a: CriteriaAdjustmentSuggestion,
  b: CriteriaAdjustmentSuggestion,
): number {
  const ka = CRITERIA_ADJUSTMENT_KINDS.indexOf(a.kind);
  const kb = CRITERIA_ADJUSTMENT_KINDS.indexOf(b.kind);
  if (ka !== kb) return ka - kb;
  if (a.category !== b.category) {
    if (a.category === null) return 1;
    if (b.category === null) return -1;
    return a.category < b.category ? -1 : 1;
  }
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

interface Candidate {
  kind: CriteriaAdjustmentSuggestion['kind'];
  category: SignalCategory | null;
  slug: string;
}

/**
 * Derive the criteria-adjustment suggestions for a profile. Denominators are the
 * resolved-analyzable cohort ONLY; every excluded population is disclosed in
 * `totals`. Below `MIN_RESOLVED_ANALYZABLE` the status is `insufficient_data`
 * with zero suggestions (firing rarely is honest). No floats anywhere ⇒ stable
 * serialization; suggestions sorted by the determinism law above.
 */
export function suggestCriteriaAdjustments(
  input: SuggestCriteriaAdjustmentsInput,
): SuggestCriteriaAdjustmentsResult {
  const { criteria, applications } = input;

  // Precompute the candidate slug tokenizations once (shared across all apps).
  const slugTokens = new Map<string, string[]>();
  for (const slug of candidateSlugUniverse(criteria))
    slugTokens.set(slug, tokenizeForMatching(slug));

  let exposed = 0;
  let resolved = 0;
  let inFlight = 0;
  let withdrawnCensored = 0;
  let withoutRequirements = 0;
  const analyzed: AnalyzedApplication[] = [];
  const ranks: Partial<Record<ApplicationStage, number>> = APPLICATION_STAGE_RANKS;

  for (const app of applications) {
    const stages = stagesOf(app);
    const furthest = furthestRankedStage(stages);
    // furthestRankedStage only ever returns a ranked stage, but its type is the
    // full enum; the `?? -1` keeps the index total without widening the map.
    const progressed = furthest !== undefined && (ranks[furthest] ?? -1) >= PROGRESSED_MIN_RANK;
    const isExposed = [...stages].some((stage) => EXPOSED_STAGES.has(stage));
    // resolved := progressed OR rejected reached (a rejection is a final signal;
    // an in-flight/ghosted application is neither and never enters a denominator).
    const isResolved = progressed || stages.has('rejected');
    // withdrawn without progression = censored-by-choice; withdrawn-after-
    // progression already counts as progressed above.
    const isWithdrawnCensored = !isResolved && stages.has('withdrawn');
    const isInFlight = !isResolved && !isWithdrawnCensored;
    const hasRequirements = app.requirements !== null && app.requirements.length > 0;
    const isAnalyzable = isResolved && hasRequirements;

    if (isExposed) exposed += 1;
    if (isResolved) resolved += 1;
    if (isInFlight) inFlight += 1;
    if (isWithdrawnCensored) withdrawnCensored += 1;
    if (isResolved && !hasRequirements) withoutRequirements += 1;

    if (!isAnalyzable) continue;

    // requirements is non-null here (isAnalyzable ⇒ hasRequirements).
    const requirements = app.requirements as SuggestCriteriaRequirement[];
    const matchedSlugs = new Set<string>();
    for (const [slug, tokens] of slugTokens) {
      if (requirementsMatchSlug(requirements, tokens)) matchedSlugs.add(slug);
    }

    analyzed.push({
      app,
      progressed,
      furthestStage: furthest ?? app.currentStage,
      matchedSlugs,
    });
  }

  const totals: CriteriaSuggestionTotals = {
    applications: applications.length,
    exposed,
    resolved,
    analyzable: analyzed.length,
    inFlight,
    withdrawnCensored,
    withoutRequirements,
  };

  if (analyzed.length < MIN_RESOLVED_ANALYZABLE) {
    return { status: 'insufficient_data', totals, suggestions: [] };
  }

  // Candidate universe WITH kind/category context (a slug can appear in a
  // positive category AND in the negative list — distinct candidates).
  const candidates: Candidate[] = [];
  for (const category of SIGNAL_CATEGORIES) {
    for (const slug of criteria.positiveSignals[category]) {
      candidates.push({ kind: 'remove_positive_signal', category, slug });
    }
  }
  for (const slug of criteria.negativeSignals) {
    candidates.push({ kind: 'remove_negative_signal', category: null, slug });
  }

  const suggestions: CriteriaAdjustmentSuggestion[] = [];
  for (const candidate of candidates) {
    let matchedTotal = 0;
    let matchedProgressed = 0;
    let unmatchedTotal = 0;
    let unmatchedProgressed = 0;
    const matchedPostings: Array<CriteriaAdjustmentPosting & { appliedOn: string | null }> = [];

    for (const a of analyzed) {
      if (a.matchedSlugs.has(candidate.slug)) {
        matchedTotal += 1;
        if (a.progressed) matchedProgressed += 1;
        matchedPostings.push({
          applicationId: a.app.applicationId,
          postingId: a.app.postingId,
          company: a.app.company,
          title: a.app.title,
          furthestStage: a.furthestStage,
          outcome: a.progressed ? 'progressed' : 'rejected_before_screen',
          appliedOn: a.app.appliedOn,
        });
      } else {
        unmatchedTotal += 1;
        if (a.progressed) unmatchedProgressed += 1;
      }
    }

    const fires =
      candidate.kind === 'remove_positive_signal'
        ? // The signal argues FOR a match but matched postings never progressed,
          // while unmatched postings did — the signal is steering wrong.
          matchedTotal >= MIN_MATCHED_CELL &&
          matchedProgressed === 0 &&
          unmatchedTotal >= MIN_UNMATCHED_CELL &&
          unmatchedProgressed >= MIN_COUNTER_PROGRESSED &&
          criteria.positiveSignals[candidate.category as SignalCategory].length >= 2
        : // The signal penalizes a match, yet matched postings progress at least
          // as well as unmatched — the penalty is unjustified (integer rate
          // compare: matched.progressed/matched.total >= unmatched.progressed/unmatched.total).
          matchedTotal >= MIN_MATCHED_CELL &&
          matchedProgressed >= MIN_COUNTER_PROGRESSED &&
          unmatchedTotal >= MIN_UNMATCHED_CELL &&
          matchedProgressed * unmatchedTotal >= unmatchedProgressed * matchedTotal &&
          criteria.negativeSignals.length >= 2;

    if (!fires) continue;

    matchedPostings.sort((a, b) => {
      if (a.appliedOn !== b.appliedOn) {
        if (a.appliedOn === null) return 1;
        if (b.appliedOn === null) return -1;
        return a.appliedOn < b.appliedOn ? -1 : 1;
      }
      return a.applicationId < b.applicationId ? -1 : a.applicationId > b.applicationId ? 1 : 0;
    });

    suggestions.push({
      kind: candidate.kind,
      category: candidate.category,
      slug: candidate.slug,
      evidence: {
        matched: { total: matchedTotal, progressed: matchedProgressed },
        unmatched: { total: unmatchedTotal, progressed: unmatchedProgressed },
        // Project to the wire shape, dropping the sort-only appliedOn field.
        matchedPostings: matchedPostings.map((posting) => ({
          applicationId: posting.applicationId,
          postingId: posting.postingId,
          company: posting.company,
          title: posting.title,
          furthestStage: posting.furthestStage,
          outcome: posting.outcome,
        })),
      },
    });
  }

  suggestions.sort(compareSuggestions);
  return { status: 'ok', totals, suggestions };
}
