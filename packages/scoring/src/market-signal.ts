import {
  GAP_CLASSIFICATIONS,
  normalizeWhitespace,
  tokenizeForMatching,
  type EvidenceStrength,
  type GapClassification,
  type RequirementCategory,
  type RequirementKind,
} from '@careerforge/core';

import { round4 } from './matching.ts';
import { EVIDENCE_WEIGHTS } from './prepare.ts';

// M9-02 (V2-PLAN 3.5): a PURE, deterministic market-signal aggregator - the next
// borrower of the fit engine's coverage currency and text normalizers. Data-in/
// data-out: no DB, no clock, no randomness, no I/O (the packages/scoring class; it
// never imports packages/llm). It groups the user's saved postings' extracted
// requirements by EXACT-TEXT recurrence and emits EXPLAINABLE counts per group -
// frequency, must-have/preferred split, hard-filter presence, the engine's own
// evidence-weight currency, classification counts, category set, gap.id links, and
// a certification-mention probe - then routes each group through a pinned,
// first-match ladder into Sharpen / Prove / Build / Certify (or a reasoned
// noAction). Nothing aggregates across factors into a single "market score": every
// emitted figure is a COUNT or an engine-currency evidence WEIGHT, and the core
// z.strictObject wire schemas forbid adding one silently (the never-one-merged-
// score lineage - ats-coverage / suggest-criteria-adjustments class).
//
// GROUPING IDENTITY (D2): normalizeWhitespace(requirementText) - the EXACT key the
// learning-payload seenInNPostings count and the content gap carry-forward already
// mint. Read-only borrower of the ADR-0006 verbatim contract: case- and
// punctuation-sensitive, so paraphrases UNDER-group (the conservative direction -
// recurrence can only under-count, never overclaim; residual R1). normalizeWhitespace
// is NEVER edited or loosened here (fork-a-new-normalizer law). The unit is the
// requirement-content group, not the profile skill, because genuine_gap rows
// typically have NO profile-skill linkage (that absence is what makes them gaps) -
// the requirement text is the only identity they share.
//
// STALENESS (R2): classifications are as-of each report's scoring time; a skill
// upgraded (ADR-0014) after a posting was scored shows its old classification until
// re-score. The honesty copy carries this. Certification framing (ADR-0017): a cert
// is pointed at ONLY when real non-excluded postings the user is chasing actually
// ask for it - the Certify bucket is deterministic posting-text keyword evidence
// with counts, never a model suggestion.

/** One requirement instance from a posting's LATEST fit report (the repository
 *  supplies latest-report-only, user-scoped rows). evidenceStrengths carries this
 *  requirement's evidence-link strengths on this report; [] when none. */
export interface MarketSignalInstance {
  postingId: string;
  fitReportId: string;
  reportVerdict: 'scored' | 'excluded';
  reportReviewStatus: 'draft' | 'reviewed';
  gapId: string;
  requirementId: string;
  requirementText: string;
  kind: RequirementKind;
  category: RequirementCategory;
  classification: GapClassification;
  userOverridden: boolean;
  evidenceStrengths: EvidenceStrength[];
}

/** A gap.id link (the V2-PLAN "links into learning plans/exercises via gaps.id"). */
export interface MarketSignalRef {
  gapId: string;
  postingId: string;
  fitReportId: string;
  classification: GapClassification;
}

/** The certification-mention probe result for a group (D4 step 3). */
export interface MarketSignalCertification {
  mentioned: boolean;
  /** Distinct NON-excluded postings whose instance text fires the probe. */
  postingCount: number;
  matchedTerms: string[];
}

/** Counts per gap classification (all five keys always present). */
export type MarketSignalClassificationCounts = Record<GapClassification, number>;

/** One recurrence group - every figure a count or the engine's evidence weight. */
export interface MarketSignalGroup {
  /** normalizeWhitespace(requirementText) - the recurrence key. */
  key: string;
  /** Raw requirementText of the group's first instance in deterministic order
   *  (posting-derived UNTRUSTED display data; the UI escapes it). */
  displayText: string;
  postingCount: number;
  instanceCount: number;
  mustHavePostingCount: number;
  niceToHavePostingCount: number;
  excludedPostingCount: number;
  /** Max over instances of the per-instance evidence coverage (0 = no evidence) -
   *  the engine's own EVIDENCE_WEIGHTS currency, never a recomputed fit score. */
  bestEvidenceWeight: number;
  /** round4(mean of per-instance evidence coverage). */
  meanEvidenceWeight: number;
  classificationCounts: MarketSignalClassificationCounts;
  overriddenCount: number;
  /** M12-02: count of `unknown` (insufficient-evidence) instances - the visible
   *  "needs your input" signal, surfaced on every group. */
  needsInputCount: number;
  /** Distinct requirement categories present, sorted. */
  categories: RequirementCategory[];
  refs: MarketSignalRef[];
  certification: MarketSignalCertification;
}

export type MarketSignalNoActionReason =
  'covered_or_low_priority' | 'all_postings_excluded' | 'needs_input';

/** A grouped-but-bucket-less group with the reason it takes no action (D4). */
export interface MarketSignalNoActionGroup extends MarketSignalGroup {
  reason: MarketSignalNoActionReason;
}

export interface MarketSignalBuckets {
  sharpen: MarketSignalGroup[];
  prove: MarketSignalGroup[];
  build: MarketSignalGroup[];
  certify: MarketSignalGroup[];
}

/** The aggregator's return value: the wire report MINUS honesty + cohort (the
 *  service composes those). Counts only; scorerVersion rides for reproducibility. */
export interface MarketSignalResult {
  scorerVersion: number;
  buckets: MarketSignalBuckets;
  noAction: MarketSignalNoActionGroup[];
  groupCount: number;
  instanceCount: number;
}

/** Bumped whenever the aggregation semantics change (inputs immutable + this rides
 *  the response = reproducibility without persistence). M12-02 -> 2: the new
 *  evidence-status classes change cohort routing (needs_input reason,
 *  needsInputCount; satisfied_fact/not_applicable are non-actionable). */
export const MARKET_SIGNAL_SCORER_VERSION = 2;

/** The claim ceiling - byte-pinned by a scoring test AND asserted verbatim on the
 *  wire by the route test. Recurrence arithmetic over the user's own saved
 *  postings, never a market prediction. */
export const MARKET_SIGNAL_HONESTY =
  "Deterministic counts over your saved postings' extracted requirements. Recurrence is exact-text recurrence, not meaning; classifications are as of each posting's latest fit report, not re-scored; certification mentions are keyword evidence, not advice.";

/** Minimum distinct non-excluded mentioning postings for the Certify bucket (the
 *  ADR-0017 investment framing made deterministic: one posting asking never
 *  justifies a credential purchase). Pinned judgment const, boundary-tested (R3). */
export const CERTIFY_MIN_POSTINGS = 2;

/** CLOSED, exact-membership test-locked set of lowercase certification TOKENS
 *  (never substrings - `concert`/`certainly` are pinned negatives; token-level
 *  membership via tokenizeForMatching). Widening is a deliberate one-line + test
 *  row change (R4). */
export const CERTIFICATION_TERMS: ReadonlySet<string> = new Set([
  'certification',
  'certifications',
  'certified',
  'certificate',
  'certificates',
  'cert',
]);

/** Classifications that argue for action (V2-PLAN maps to Build/Sharpen/Prove). */
const ACTIONABLE_CLASSIFICATIONS: readonly GapClassification[] = [
  'needs_refresh',
  'have_undemonstrated',
  'genuine_gap',
];

/** Modal tie-break order: first wins (R3, pinned + boundary-tested). */
export const BUCKET_SEVERITY: readonly GapClassification[] = [
  'genuine_gap',
  'needs_refresh',
  'have_undemonstrated',
];

const ACTIONABLE_TO_BUCKET: Record<
  'needs_refresh' | 'have_undemonstrated' | 'genuine_gap',
  'sharpen' | 'prove' | 'build'
> = {
  needs_refresh: 'sharpen',
  have_undemonstrated: 'prove',
  genuine_gap: 'build',
};

/** UTF-16 code-unit comparison - locale-independent (localeCompare would import the
 *  host locale into the output ordering; prepare.ts discipline). */
const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Best evidence weight for one instance (0 = no evidence). Mirrors scoring's
 *  exported coverageOf semantics on a bare EvidenceStrength[] - the plan-audit-
 *  ratified deviation (reviews/PLAN-m9-02.md): coverageOf takes EvidenceLink[]
 *  (7-field strictObject), while an aggregated instance carries only strengths
 *  (dragging quote text into the aggregate would be worse). Same currency. */
function coverageOfStrengths(strengths: readonly EvidenceStrength[]): number {
  if (strengths.length === 0) return 0;
  return Math.max(...strengths.map((strength) => EVIDENCE_WEIGHTS[strength]));
}

function emptyClassificationCounts(): MarketSignalClassificationCounts {
  // Derived from the vocabulary (M12-02) so a new classification can never
  // silently miss a zero-initialized key (the core wire-schema discipline).
  return Object.fromEntries(
    GAP_CLASSIFICATIONS.map((classification) => [classification, 0]),
  ) as MarketSignalClassificationCounts;
}

/** Distinct count of a projection over instances (postingId-scoped counts). */
function distinctCount<T>(items: readonly T[]): number {
  return new Set(items).size;
}

function buildGroup(key: string, instances: MarketSignalInstance[]): MarketSignalGroup {
  // Internal, id-based instance order so caller input order can never matter (A1):
  // (postingId, fitReportId, gapId) - gapId is a unique PK, so the triple is a
  // total order. displayText and refs both read this order.
  const ordered = [...instances].sort(
    (a, b) =>
      compareStrings(a.postingId, b.postingId) ||
      compareStrings(a.fitReportId, b.fitReportId) ||
      compareStrings(a.gapId, b.gapId),
  );
  // Groups are only ever built from a non-empty recurrence bucket; the guard
  // makes that invariant explicit (and satisfies noUncheckedIndexedAccess).
  const [firstInstance] = ordered;
  if (firstInstance === undefined) throw new Error('buildGroup requires at least one instance');

  const classificationCounts = emptyClassificationCounts();
  let overriddenCount = 0;
  const coverages: number[] = [];
  const categorySet = new Set<RequirementCategory>();
  const matchedTermSet = new Set<string>();
  const firingPostings = new Set<string>();
  const mustHavePostings = new Set<string>();
  const niceToHavePostings = new Set<string>();
  const excludedPostings = new Set<string>();
  const refs: MarketSignalRef[] = [];

  for (const instance of ordered) {
    classificationCounts[instance.classification] += 1;
    if (instance.userOverridden) overriddenCount += 1;
    coverages.push(coverageOfStrengths(instance.evidenceStrengths));
    categorySet.add(instance.category);
    if (instance.kind === 'must_have') mustHavePostings.add(instance.postingId);
    else niceToHavePostings.add(instance.postingId);
    if (instance.reportVerdict === 'excluded') excludedPostings.add(instance.postingId);

    const tokens = new Set(tokenizeForMatching(instance.requirementText));
    const matched = [...CERTIFICATION_TERMS].filter((term) => tokens.has(term));
    if (matched.length > 0) {
      for (const term of matched) matchedTermSet.add(term);
      // Certify only counts postings the user is actually chasing (non-excluded).
      if (instance.reportVerdict !== 'excluded') firingPostings.add(instance.postingId);
    }

    refs.push({
      gapId: instance.gapId,
      postingId: instance.postingId,
      fitReportId: instance.fitReportId,
      classification: instance.classification,
    });
  }

  const bestEvidenceWeight = coverages.length === 0 ? 0 : Math.max(...coverages);
  const meanEvidenceWeight =
    coverages.length === 0
      ? 0
      : round4(coverages.reduce((sum, value) => sum + value, 0) / coverages.length);

  return {
    key,
    displayText: firstInstance.requirementText,
    postingCount: distinctCount(ordered.map((instance) => instance.postingId)),
    instanceCount: ordered.length,
    mustHavePostingCount: mustHavePostings.size,
    niceToHavePostingCount: niceToHavePostings.size,
    excludedPostingCount: excludedPostings.size,
    bestEvidenceWeight,
    meanEvidenceWeight,
    classificationCounts,
    overriddenCount,
    needsInputCount: classificationCounts.unknown,
    categories: [...categorySet].sort(compareStrings),
    refs,
    certification: {
      mentioned: matchedTermSet.size > 0,
      postingCount: firingPostings.size,
      matchedTerms: [...matchedTermSet].sort(compareStrings),
    },
  };
}

/** The modal actionable classification, ties broken by BUCKET_SEVERITY (first
 *  wins). Precondition: at least one actionable instance in the group. */
function modalActionable(
  group: MarketSignalGroup,
): 'needs_refresh' | 'have_undemonstrated' | 'genuine_gap' {
  let winner: 'needs_refresh' | 'have_undemonstrated' | 'genuine_gap' = 'genuine_gap';
  let winnerCount = -1;
  for (const classification of BUCKET_SEVERITY) {
    // BUCKET_SEVERITY only lists actionable classifications, in tie-break order.
    const actionable = classification as 'needs_refresh' | 'have_undemonstrated' | 'genuine_gap';
    const count = group.classificationCounts[actionable];
    if (count > winnerCount) {
      winnerCount = count;
      winner = actionable;
    }
  }
  return winner;
}

/** The pinned first-match ladder (D4). Returns a bucket key, or a noAction reason. */
function classifyGroup(
  group: MarketSignalGroup,
): keyof MarketSignalBuckets | MarketSignalNoActionReason {
  const actionableCount = ACTIONABLE_CLASSIFICATIONS.reduce(
    (sum, classification) => sum + group.classificationCounts[classification],
    0,
  );
  // 1. Nothing actionable. M12-02: distinguish "we don't know" (at least one
  //    unknown -> needs your input) from genuinely covered/low-priority/
  //    satisfied_fact/not_applicable. An all-unknown group is NEVER "covered".
  if (actionableCount === 0) {
    return group.needsInputCount > 0 ? 'needs_input' : 'covered_or_low_priority';
  }
  // 2. Every instance from an excluded-verdict posting is noise (mixed groups stay in).
  if (group.excludedPostingCount === group.postingCount) return 'all_postings_excluded';
  // 3. Certify iff enough distinct non-excluded postings ask for a credential.
  if (group.certification.postingCount >= CERTIFY_MIN_POSTINGS) return 'certify';
  // 4. Else the modal actionable classification.
  return ACTIONABLE_TO_BUCKET[modalActionable(group)];
}

/** Groups sort by postingCount desc, then key asc (buckets and noAction alike). */
function sortGroups<T extends MarketSignalGroup>(groups: T[]): T[] {
  return [...groups].sort(
    (a, b) => b.postingCount - a.postingCount || compareStrings(a.key, b.key),
  );
}

/**
 * Aggregate market signal from requirement instances. Pure + deterministic: two
 * calls with the same input SET deep-equal, and caller input order does not change
 * the output (the module sorts every intermediate itself). No merged/composite
 * score is produced anywhere.
 */
export function aggregateMarketSignal(instances: MarketSignalInstance[]): MarketSignalResult {
  const byKey = new Map<string, MarketSignalInstance[]>();
  for (const instance of instances) {
    const key = normalizeWhitespace(instance.requirementText);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(instance);
    else byKey.set(key, [instance]);
  }

  const buckets: MarketSignalBuckets = { sharpen: [], prove: [], build: [], certify: [] };
  const noAction: MarketSignalNoActionGroup[] = [];

  for (const [key, groupInstances] of byKey) {
    const group = buildGroup(key, groupInstances);
    const verdict = classifyGroup(group);
    if (
      verdict === 'covered_or_low_priority' ||
      verdict === 'all_postings_excluded' ||
      verdict === 'needs_input'
    ) {
      noAction.push({ ...group, reason: verdict });
    } else {
      buckets[verdict].push(group);
    }
  }

  return {
    scorerVersion: MARKET_SIGNAL_SCORER_VERSION,
    buckets: {
      sharpen: sortGroups(buckets.sharpen),
      prove: sortGroups(buckets.prove),
      build: sortGroups(buckets.build),
      certify: sortGroups(buckets.certify),
    },
    noAction: sortGroups(noAction),
    groupCount: byKey.size,
    instanceCount: instances.length,
  };
}
