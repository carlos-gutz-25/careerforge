import {
  tokenizeForMatching,
  type AtsCoverageReport,
  type AtsEvidenceLocation,
  type AtsKeywordStuffing,
  type AtsLengthBalance,
  type AtsLengthFlag,
  type AtsLengthSection,
  type AtsRequirementCoverage,
  type AtsRequirementCoverageRow,
  type AtsRequirementStatus,
  type CanonicalResumeDoc,
  type RequirementCategory,
  type RequirementKind,
} from '@careerforge/core';

import { round4 } from './matching.ts';

// M6-06 (ADR-0018 "ATS Resilience"): a PURE, deterministic ATS-coverage scorer -
// the next borrower of the fit engine's matching normalizer. Data-in/data-out:
// no DB, no clock, no randomness, no I/O (the packages/scoring class; it never
// imports packages/llm). It produces THREE SEPARATE, never-merged results
// (per-requirement coverage, a keyword-stuffing lint, a length-balance check) +
// a version stamp; nothing aggregates across them into a single "ATS score"
// (V2-PLAN 59 - the honesty copy IS the ceiling). The wire SHAPES live in
// @careerforge/core (resume-document.ts, beside parse-audit); this module owns
// the honesty statement and every threshold/stopword const.
//
// What it measures: TOKEN PRESENCE, never MEANING (R1). A synonym the resume
// uses instead of the requirement's word is invisible (under-count, the safe
// direction); a generic content word the stopword set does not catch can inflate
// a `partial` (over-count, named). The scorer proves tokens overlap - never that
// the candidate is a fit. ATS_COVERAGE_HONESTY exists precisely for this.
//
// Doc content SURFACE (what coverage reads): every claim's composed prose, every
// skill name, the headline, and each education row's institution + credential.
// DELIBERATELY EXCLUDED: fullName / email / phone / location / links - identity
// fields, not content; coverage measures what the resume SAYS, not who it is.
//
// Named deviation (recorded): the shared normalizer's `phraseMatches` (ordered
// token-subsequence over a slug inventory) is NOT the combinator here - a
// requirement is a prose sentence with no phrase inventory to anchor. Token-SET
// overlap against the doc's token union is the deterministic primitive that
// fits. Same normalizer (`tokenizeForMatching`), different combinator.

/** The scorer's per-requirement input - the extraction-run requirement the fit
 *  report was scored against. Tri-state `quoteVerified` is CARRIED through to
 *  the wire (D3), never used to filter. */
export interface AtsRequirementInput {
  requirementId: string;
  text: string;
  kind: RequirementKind;
  category: RequirementCategory;
  quoteVerified: boolean | null;
}

/** The scorer's return value: the wire report MINUS the honesty string (the
 *  route composes the wire response by adding ATS_COVERAGE_HONESTY). Three
 *  separate named results + the reproducibility version stamp. */
export type AtsCoverageResult = Omit<AtsCoverageReport, 'honesty'>;

/** Bumped whenever the scoring semantics change (inputs are immutable + this
 *  rides the response = reproducibility without persistence). */
export const ATS_COVERAGE_SCORER_VERSION = 1;

/** The claim ceiling. Byte-pinned by a scoring test AND asserted verbatim on the
 *  wire by the route test - the scorer, never a real ATS, is what this measures. */
export const ATS_COVERAGE_HONESTY =
  "Deterministic checks against this posting's extracted requirements - not a prediction of any real ATS.";

/** A requirement is a `hit` at or above this content-token match ratio (the 0.6
 *  boundary is itself a hit). Pinned judgment const (R3). */
export const ATS_COVERAGE_HIT_RATIO = 0.6;

/** Per-requirement evidence locations are capped here; `matchedSourceCount`
 *  discloses the pre-cap total so nothing is silently hidden. */
export const ATS_COVERAGE_EVIDENCE_MAX = 8;

/** Keyword-stuffing: a token must repeat at least this many times AND exceed the
 *  density ceiling to flag (both pinned; the count floor keeps a tiny doc honest,
 *  the density leg keeps a long doc honest). */
export const KEYWORD_STUFFING_MIN_COUNT = 4;
export const KEYWORD_STUFFING_DENSITY_MAX = 0.05;

/** Length-balance advisory thresholds (pinned judgment consts, R3). */
export const LENGTH_TOTAL_SHORT_WORDS = 120;
export const LENGTH_TOTAL_LONG_WORDS = 1000;
export const LENGTH_SUMMARY_HEAVY_SHARE = 0.35;
export const LENGTH_SKILLS_HEAVY_SHARE = 0.25;

/** Byte-pinned suggestion template fragments (the only variable slot is the
 *  comma-joined unmatched tokens). The copy NEVER invites fabrication - it points
 *  the reviewer at real evidence or an honest redraft (ADR-0018 never-fabricate). */
export const ATS_MISS_SUGGESTION_PREFIX = "No resume content matches this requirement's terms (";
export const ATS_MISS_SUGGESTION_SUFFIX =
  '). Add or cite real evidence in your profile, or redraft - never invent experience.';
export const ATS_PARTIAL_SUGGESTION_PREFIX = 'Partially covered - unmatched terms: ';
export const ATS_PARTIAL_SUGGESTION_SUFFIX =
  '. Strengthen only with content your evidence actually supports.';

/** CLOSED, exact-membership test-locked set of common English function words -
 *  articles, conjunctions, prepositions, auxiliaries, demonstratives, pronouns.
 *  This mints the pinned stopword list the M4-02 phraseMatches residual named as
 *  missing, SCOPED TO THIS SCORER ONLY (the fit engine's semantics are
 *  untouched). Any widening is a deliberate, test-visible edit. `it`/`its` are
 *  intentionally ABSENT so the domain term "IT" survives as a content token. */
export const ATS_COVERAGE_STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'nor',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'with',
  'for',
  'from',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'am',
  'do',
  'does',
  'did',
  'has',
  'have',
  'had',
  'will',
  'would',
  'can',
  'could',
  'should',
  'this',
  'that',
  'these',
  'those',
  'you',
  'your',
  'we',
  'our',
  'they',
  'their',
]);

/** Unique tokens preserving first-appearance order. */
function uniqueInOrder(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

/** DISPLAY-honest word count (whitespace split over the display string, NOT the
 *  matching normalizer). Empty/whitespace-only yields 0. */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** The education row's display string for both matching and word counts:
 *  institution + non-empty credential. */
function educationText(institution: string, credential: string | null): string {
  return [institution, credential]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' ');
}

interface DocSource {
  location: AtsEvidenceLocation;
  tokens: ReadonlySet<string>;
}

/** Ordered content sources for evidence attribution (claims by position, then
 *  skills by input order, then headline, then education by index). */
function buildDocSources(doc: CanonicalResumeDoc): DocSource[] {
  const sources: DocSource[] = [];

  const orderedClaims = doc.claims
    .map((claim, index) => ({ claim, index }))
    .sort((a, b) => a.claim.position - b.claim.position || a.index - b.index);
  for (const { claim } of orderedClaims) {
    sources.push({
      location: { kind: 'claim', section: claim.section, position: claim.position },
      tokens: new Set(tokenizeForMatching(claim.text)),
    });
  }

  for (const skill of doc.skills) {
    sources.push({
      location: { kind: 'skill', name: skill.name },
      tokens: new Set(tokenizeForMatching(skill.name)),
    });
  }

  if (doc.contact.headline !== null) {
    sources.push({
      location: { kind: 'headline' },
      tokens: new Set(tokenizeForMatching(doc.contact.headline)),
    });
  }

  doc.education.forEach((edu, index) => {
    sources.push({
      location: { kind: 'education', index },
      tokens: new Set(tokenizeForMatching(educationText(edu.institution, edu.credential))),
    });
  });

  return sources;
}

function missSuggestion(top3: string): string {
  return ATS_MISS_SUGGESTION_PREFIX + top3 + ATS_MISS_SUGGESTION_SUFFIX;
}
function partialSuggestion(top3: string): string {
  return ATS_PARTIAL_SUGGESTION_PREFIX + top3 + ATS_PARTIAL_SUGGESTION_SUFFIX;
}

function scoreRequirementCoverage(
  requirements: AtsRequirementInput[],
  sources: DocSource[],
  docTokens: ReadonlySet<string>,
): { coverage: AtsRequirementCoverage; contentByRequirement: string[][] } {
  const rows: AtsRequirementCoverageRow[] = [];
  const contentByRequirement: string[][] = [];
  let hit = 0;
  let partial = 0;
  let miss = 0;

  for (const requirement of requirements) {
    const reqTokens = uniqueInOrder(tokenizeForMatching(requirement.text));
    const contentTokens = reqTokens.filter((token) => !ATS_COVERAGE_STOPWORDS.has(token));
    contentByRequirement.push(contentTokens);

    const matchedTokens = contentTokens.filter((token) => docTokens.has(token));
    const unmatchedTokens = contentTokens.filter((token) => !docTokens.has(token));
    const matchedSet = new Set(matchedTokens);
    const ratio =
      contentTokens.length === 0 ? 0 : round4(matchedTokens.length / contentTokens.length);

    let status: AtsRequirementStatus;
    if (matchedTokens.length === 0) status = 'miss';
    else if (ratio >= ATS_COVERAGE_HIT_RATIO) status = 'hit';
    else status = 'partial';

    if (status === 'hit') hit += 1;
    else if (status === 'partial') partial += 1;
    else miss += 1;

    const matchingSources = sources.filter((source) =>
      [...matchedSet].some((token) => source.tokens.has(token)),
    );
    const evidence = matchingSources
      .slice(0, ATS_COVERAGE_EVIDENCE_MAX)
      .map((source) => source.location);

    const top3 = unmatchedTokens.slice(0, 3).join(', ');
    const suggestion =
      status === 'miss'
        ? missSuggestion(top3)
        : status === 'partial'
          ? partialSuggestion(top3)
          : undefined;

    rows.push({
      requirementId: requirement.requirementId,
      text: requirement.text,
      kind: requirement.kind,
      category: requirement.category,
      quoteVerified: requirement.quoteVerified,
      status,
      ratio,
      contentTokenCount: contentTokens.length,
      matchedTokens,
      unmatchedTokens,
      matchedSourceCount: matchingSources.length,
      evidence,
      ...(suggestion === undefined ? {} : { suggestion }),
    });
  }

  return { coverage: { requirements: rows, counts: { hit, partial, miss } }, contentByRequirement };
}

function scoreKeywordStuffing(
  doc: CanonicalResumeDoc,
  contentByRequirement: string[][],
): AtsKeywordStuffing {
  // Density lives in composed prose; the skills list is a legitimate single-
  // mention surface, so the lint reads CLAIM texts only.
  const claimTokens: string[] = [];
  for (const claim of doc.claims) claimTokens.push(...tokenizeForMatching(claim.text));
  const totalClaimTokens = claimTokens.length;

  const counts = new Map<string, number>();
  for (const token of claimTokens) counts.set(token, (counts.get(token) ?? 0) + 1);

  const candidates = uniqueInOrder(contentByRequirement.flat());
  const flaggedTokens = candidates
    .map((token) => {
      const count = counts.get(token) ?? 0;
      const density = totalClaimTokens === 0 ? 0 : round4(count / totalClaimTokens);
      return { token, count, density };
    })
    .filter(
      (entry) =>
        entry.count >= KEYWORD_STUFFING_MIN_COUNT && entry.density > KEYWORD_STUFFING_DENSITY_MAX,
    );

  return { ok: flaggedTokens.length === 0, totalClaimTokens, flaggedTokens };
}

function scoreLengthBalance(doc: CanonicalResumeDoc): AtsLengthBalance {
  const wordsBySection: Record<AtsLengthSection, number> = {
    summary: 0,
    experience: 0,
    project: 0,
    skills: 0,
    education: 0,
    headline: 0,
  };

  for (const claim of doc.claims) wordsBySection[claim.section] += countWords(claim.text);
  for (const skill of doc.skills) wordsBySection.skills += countWords(skill.name);
  for (const edu of doc.education) {
    wordsBySection.education += countWords(educationText(edu.institution, edu.credential));
  }
  if (doc.contact.headline !== null) wordsBySection.headline += countWords(doc.contact.headline);

  const order: AtsLengthSection[] = [
    'summary',
    'experience',
    'project',
    'skills',
    'education',
    'headline',
  ];
  const totalWords = order.reduce((sum, section) => sum + wordsBySection[section], 0);
  const sections = order.map((section) => ({
    section,
    words: wordsBySection[section],
    share: totalWords === 0 ? 0 : round4(wordsBySection[section] / totalWords),
  }));

  const summaryShare = totalWords === 0 ? 0 : wordsBySection.summary / totalWords;
  const skillsShare = totalWords === 0 ? 0 : wordsBySection.skills / totalWords;
  const flags: AtsLengthFlag[] = [];
  if (totalWords < LENGTH_TOTAL_SHORT_WORDS) flags.push('total-short');
  if (totalWords > LENGTH_TOTAL_LONG_WORDS) flags.push('total-long');
  if (summaryShare > LENGTH_SUMMARY_HEAVY_SHARE) flags.push('summary-heavy');
  if (skillsShare > LENGTH_SKILLS_HEAVY_SHARE) flags.push('skills-heavy');

  return { totalWords, sections, flags };
}

/** Score a composed resume document against its posting's extracted
 *  requirements. Pure + deterministic (two calls deep-equal). */
export function scoreAtsCoverage(
  doc: CanonicalResumeDoc,
  requirements: AtsRequirementInput[],
): AtsCoverageResult {
  const sources = buildDocSources(doc);
  const docTokens = new Set<string>();
  for (const source of sources) for (const token of source.tokens) docTokens.add(token);

  const { coverage, contentByRequirement } = scoreRequirementCoverage(
    requirements,
    sources,
    docTokens,
  );
  const keywordStuffing = scoreKeywordStuffing(doc, contentByRequirement);
  const lengthBalance = scoreLengthBalance(doc);

  return {
    scorerVersion: ATS_COVERAGE_SCORER_VERSION,
    requirementCoverage: coverage,
    keywordStuffing,
    lengthBalance,
  };
}
