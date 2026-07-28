import {
  type AtsRequirementCoverageRow,
  type CanonicalResumeDoc,
  type CanonicalClaim,
  type CanonicalSkill,
  type ResumeClaimSection,
  type SkillLevel,
} from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import {
  ATS_COVERAGE_EVIDENCE_MAX,
  ATS_COVERAGE_HIT_RATIO,
  ATS_COVERAGE_HONESTY,
  ATS_COVERAGE_SCORER_VERSION,
  ATS_COVERAGE_STOPWORDS,
  ATS_MISS_SUGGESTION_PREFIX,
  ATS_MISS_SUGGESTION_SUFFIX,
  ATS_PARTIAL_SUGGESTION_PREFIX,
  ATS_PARTIAL_SUGGESTION_SUFFIX,
  KEYWORD_STUFFING_DENSITY_MAX,
  KEYWORD_STUFFING_MIN_COUNT,
  LENGTH_SKILLS_HEAVY_SHARE,
  LENGTH_SUMMARY_HEAVY_SHARE,
  LENGTH_TOTAL_LONG_WORDS,
  LENGTH_TOTAL_SHORT_WORDS,
  scoreAtsCoverage,
  type AtsRequirementInput,
} from './ats-coverage.ts';

// All fixture data is fictional (RISKS P-01). The scorer is pure - these tests
// need no DB, provider, or network.

function makeDoc(over: Partial<CanonicalResumeDoc> = {}): CanonicalResumeDoc {
  return {
    contact: {
      fullName: 'Robin Vale',
      headline: null,
      email: null,
      phone: null,
      location: null,
      links: [],
    },
    education: [],
    skills: [],
    claims: [],
    ...over,
  };
}
function claim(section: ResumeClaimSection, position: number, text: string): CanonicalClaim {
  return { section, entityRef: null, entityLabel: null, text, position };
}
function skill(name: string, level: SkillLevel = 'solid'): CanonicalSkill {
  return { name, level };
}
function wordsText(n: number): string {
  return Array.from({ length: n }, () => 'word').join(' ');
}

const coverageDoc = makeDoc({
  claims: [
    claim('experience', 0, 'Built scalable typescript services on node with postgres and redis'),
    claim('summary', 1, 'Senior engineer focused on distributed systems'),
  ],
  skills: [skill('TypeScript'), skill('PostgreSQL'), skill('GraphQL')],
});

const coverageRequirements: AtsRequirementInput[] = [
  {
    requirementId: 'rA',
    text: 'TypeScript and Node',
    kind: 'must_have',
    category: 'language',
    quoteVerified: true,
  },
  {
    requirementId: 'rB',
    text: 'typescript postgres redis kotlin scala',
    kind: 'must_have',
    category: 'framework',
    quoteVerified: false,
  },
  {
    requirementId: 'rC',
    text: 'graphql rust golang',
    kind: 'nice_to_have',
    category: 'framework',
    quoteVerified: null,
  },
  {
    requirementId: 'rD',
    text: 'kubernetes helm terraform',
    kind: 'must_have',
    category: 'domain',
    quoteVerified: true,
  },
  {
    requirementId: 'rE',
    text: 'the and of to with',
    kind: 'nice_to_have',
    category: 'other',
    quoteVerified: false,
  },
];

describe('scoreAtsCoverage - requirement coverage (D2/D3)', () => {
  const result = scoreAtsCoverage(coverageDoc, coverageRequirements);

  it('produces exactly the pinned per-requirement rows (hit / 0.6-boundary hit / partial / miss / all-stopword miss)', () => {
    const expected: AtsRequirementCoverageRow[] = [
      {
        requirementId: 'rA',
        text: 'TypeScript and Node',
        kind: 'must_have',
        category: 'language',
        quoteVerified: true,
        status: 'hit',
        ratio: 1,
        contentTokenCount: 2,
        matchedTokens: ['typescript', 'node'],
        unmatchedTokens: [],
        matchedSourceCount: 2,
        evidence: [
          { kind: 'claim', section: 'experience', position: 0 },
          { kind: 'skill', name: 'TypeScript' },
        ],
      },
      {
        requirementId: 'rB',
        text: 'typescript postgres redis kotlin scala',
        kind: 'must_have',
        category: 'framework',
        quoteVerified: false,
        status: 'hit',
        ratio: 0.6,
        contentTokenCount: 5,
        matchedTokens: ['typescript', 'postgres', 'redis'],
        unmatchedTokens: ['kotlin', 'scala'],
        matchedSourceCount: 2,
        evidence: [
          { kind: 'claim', section: 'experience', position: 0 },
          { kind: 'skill', name: 'TypeScript' },
        ],
      },
      {
        requirementId: 'rC',
        text: 'graphql rust golang',
        kind: 'nice_to_have',
        category: 'framework',
        quoteVerified: null,
        status: 'partial',
        ratio: 0.3333,
        contentTokenCount: 3,
        matchedTokens: ['graphql'],
        unmatchedTokens: ['rust', 'golang'],
        matchedSourceCount: 1,
        evidence: [{ kind: 'skill', name: 'GraphQL' }],
        suggestion: `${ATS_PARTIAL_SUGGESTION_PREFIX}rust, golang${ATS_PARTIAL_SUGGESTION_SUFFIX}`,
      },
      {
        requirementId: 'rD',
        text: 'kubernetes helm terraform',
        kind: 'must_have',
        category: 'domain',
        quoteVerified: true,
        status: 'miss',
        ratio: 0,
        contentTokenCount: 3,
        matchedTokens: [],
        unmatchedTokens: ['kubernetes', 'helm', 'terraform'],
        matchedSourceCount: 0,
        evidence: [],
        suggestion: `${ATS_MISS_SUGGESTION_PREFIX}kubernetes, helm, terraform${ATS_MISS_SUGGESTION_SUFFIX}`,
      },
      {
        requirementId: 'rE',
        text: 'the and of to with',
        kind: 'nice_to_have',
        category: 'other',
        quoteVerified: false,
        status: 'miss',
        ratio: 0,
        contentTokenCount: 0,
        matchedTokens: [],
        unmatchedTokens: [],
        matchedSourceCount: 0,
        evidence: [],
        suggestion: `${ATS_MISS_SUGGESTION_PREFIX}${ATS_MISS_SUGGESTION_SUFFIX}`,
      },
    ];
    expect(result.requirementCoverage.requirements).toEqual(expected);
  });

  it('tallies counts, never a blended score, and carries scorerVersion', () => {
    expect(result.requirementCoverage.counts).toEqual({ hit: 2, partial: 1, miss: 2 });
    expect(result.scorerVersion).toBe(ATS_COVERAGE_SCORER_VERSION);
    // The "never one merged ATS score" law: the top-level result has exactly the
    // three named results + the version, nothing that aggregates across them.
    expect(Object.keys(result).sort()).toEqual([
      'keywordStuffing',
      'lengthBalance',
      'requirementCoverage',
      'scorerVersion',
    ]);
  });

  it('a hit at exactly ATS_COVERAGE_HIT_RATIO is a hit (boundary is inclusive)', () => {
    const rB = result.requirementCoverage.requirements[1];
    if (!rB) throw new Error('expected requirement rB');
    expect(rB.ratio).toBe(ATS_COVERAGE_HIT_RATIO);
    expect(rB.status).toBe('hit');
  });

  it('carries tri-state quoteVerified verbatim (transparency over exclusion)', () => {
    expect(result.requirementCoverage.requirements.map((r) => r.quoteVerified)).toEqual([
      true,
      false,
      null,
      true,
      false,
    ]);
  });

  it('a hit carries no suggestion; partial and miss do', () => {
    const reqs = result.requirementCoverage.requirements;
    expect(reqs[0]?.suggestion).toBeUndefined();
    expect(reqs[2]?.suggestion).toBeDefined();
    expect(reqs[3]?.suggestion).toBeDefined();
  });

  it('caps evidence at ATS_COVERAGE_EVIDENCE_MAX and discloses the pre-cap total', () => {
    const many = makeDoc({
      claims: Array.from({ length: 10 }, (_, i) => claim('experience', i, 'alpha')),
    });
    const row = scoreAtsCoverage(many, [
      {
        requirementId: 'r',
        text: 'alpha',
        kind: 'must_have',
        category: 'other',
        quoteVerified: true,
      },
    ]).requirementCoverage.requirements[0];
    if (!row) throw new Error('expected a coverage row');
    expect(row.matchedSourceCount).toBe(10);
    expect(row.evidence).toHaveLength(ATS_COVERAGE_EVIDENCE_MAX);
    expect(row.evidence[0]).toEqual({ kind: 'claim', section: 'experience', position: 0 });
    expect(row.evidence[ATS_COVERAGE_EVIDENCE_MAX - 1]).toEqual({
      kind: 'claim',
      section: 'experience',
      position: 7,
    });
  });

  it('empty requirement list yields empty rows and zero counts (a valid input)', () => {
    const empty = scoreAtsCoverage(coverageDoc, []);
    expect(empty.requirementCoverage.requirements).toEqual([]);
    expect(empty.requirementCoverage.counts).toEqual({ hit: 0, partial: 0, miss: 0 });
  });
});

describe('scoreAtsCoverage - keyword-stuffing lint (D4)', () => {
  it('flags a claim token that repeats across claims past both thresholds', () => {
    const doc = makeDoc({
      claims: [
        claim('summary', 0, 'synergy synergy synergy'),
        claim('experience', 1, 'synergy synergy teams'),
      ],
    });
    const result = scoreAtsCoverage(doc, [
      {
        requirementId: 'r',
        text: 'synergy',
        kind: 'must_have',
        category: 'other',
        quoteVerified: true,
      },
    ]);
    expect(result.keywordStuffing).toEqual({
      ok: false,
      totalClaimTokens: 6,
      flaggedTokens: [{ token: 'synergy', count: 5, density: 0.8333 }],
    });
  });

  it('does NOT flag the same repeat count when a long doc dilutes density below max', () => {
    const doc = makeDoc({
      claims: [claim('experience', 0, `${wordsText(195)} synergy synergy synergy synergy synergy`)],
    });
    const result = scoreAtsCoverage(doc, [
      {
        requirementId: 'r',
        text: 'synergy',
        kind: 'must_have',
        category: 'other',
        quoteVerified: true,
      },
    ]);
    expect(result.keywordStuffing.totalClaimTokens).toBe(200);
    expect(result.keywordStuffing.ok).toBe(true);
    expect(result.keywordStuffing.flaggedTokens).toEqual([]);
  });

  it('does NOT flag below KEYWORD_STUFFING_MIN_COUNT even at high density', () => {
    const doc = makeDoc({ claims: [claim('summary', 0, 'synergy synergy synergy done')] });
    const result = scoreAtsCoverage(doc, [
      {
        requirementId: 'r',
        text: 'synergy',
        kind: 'must_have',
        category: 'other',
        quoteVerified: true,
      },
    ]);
    expect(result.keywordStuffing.ok).toBe(true);
    expect(result.keywordStuffing.flaggedTokens).toEqual([]);
  });

  it('a clean doc is ok:true and only checks tokens that appear in requirements', () => {
    const doc = makeDoc({ claims: [claim('summary', 0, 'typescript is great and node is solid')] });
    const result = scoreAtsCoverage(doc, [
      {
        requirementId: 'r',
        text: 'typescript node',
        kind: 'must_have',
        category: 'language',
        quoteVerified: true,
      },
    ]);
    expect(result.keywordStuffing.ok).toBe(true);
  });
});

describe('scoreAtsCoverage - length balance (D5)', () => {
  it('flags total-short and summary-heavy with pinned section shares', () => {
    const doc = makeDoc({
      claims: [claim('summary', 0, wordsText(40)), claim('experience', 1, wordsText(35))],
      skills: [skill(wordsText(15))],
      education: [{ institution: wordsText(10), credential: null, startYear: null, endYear: null }],
    });
    const { lengthBalance } = scoreAtsCoverage(doc, []);
    expect(lengthBalance.totalWords).toBe(100);
    expect(lengthBalance.sections).toEqual([
      { section: 'summary', words: 40, share: 0.4 },
      { section: 'experience', words: 35, share: 0.35 },
      { section: 'project', words: 0, share: 0 },
      { section: 'skills', words: 15, share: 0.15 },
      { section: 'education', words: 10, share: 0.1 },
      { section: 'headline', words: 0, share: 0 },
    ]);
    expect(lengthBalance.flags).toEqual(['total-short', 'summary-heavy']);
  });

  it('flags total-long and skills-heavy (and not total-short) on a large doc', () => {
    const doc = makeDoc({
      claims: [claim('experience', 0, wordsText(800))],
      skills: [skill(wordsText(300))],
    });
    const { lengthBalance } = scoreAtsCoverage(doc, []);
    expect(lengthBalance.totalWords).toBe(1100);
    expect(lengthBalance.flags).toEqual(['total-long', 'skills-heavy']);
  });

  it('total-word boundary is strict: 120 is not short, 119 is', () => {
    const at = scoreAtsCoverage(makeDoc({ claims: [claim('experience', 0, wordsText(120))] }), []);
    expect(at.lengthBalance.totalWords).toBe(LENGTH_TOTAL_SHORT_WORDS);
    expect(at.lengthBalance.flags).toEqual([]);
    const below = scoreAtsCoverage(
      makeDoc({ claims: [claim('experience', 0, wordsText(119))] }),
      [],
    );
    expect(below.lengthBalance.flags).toEqual(['total-short']);
  });

  it('summary-heavy boundary is strict: exactly 0.35 share does not flag', () => {
    const at = scoreAtsCoverage(
      makeDoc({
        claims: [claim('summary', 0, wordsText(35)), claim('experience', 1, wordsText(65))],
      }),
      [],
    );
    expect(at.lengthBalance.flags).toEqual(['total-short']);
    const over = scoreAtsCoverage(
      makeDoc({
        claims: [claim('summary', 0, wordsText(36)), claim('experience', 1, wordsText(64))],
      }),
      [],
    );
    expect(over.lengthBalance.flags).toEqual(['total-short', 'summary-heavy']);
  });

  it('skills-heavy boundary is strict: exactly 0.25 share does not flag', () => {
    const at = scoreAtsCoverage(
      makeDoc({ claims: [claim('experience', 0, wordsText(75))], skills: [skill(wordsText(25))] }),
      [],
    );
    expect(at.lengthBalance.flags).toEqual(['total-short']);
    const over = scoreAtsCoverage(
      makeDoc({ claims: [claim('experience', 0, wordsText(74))], skills: [skill(wordsText(26))] }),
      [],
    );
    expect(over.lengthBalance.flags).toEqual(['total-short', 'skills-heavy']);
  });
});

describe('scoreAtsCoverage - determinism + pinned consts', () => {
  it('two calls on identical inputs are deep-equal (pure, no clock/randomness)', () => {
    expect(scoreAtsCoverage(coverageDoc, coverageRequirements)).toEqual(
      scoreAtsCoverage(coverageDoc, coverageRequirements),
    );
  });

  it('honesty copy is byte-exact and claims nothing beyond deterministic checks', () => {
    expect(ATS_COVERAGE_HONESTY).toBe(
      "Deterministic checks against this posting's extracted requirements - not a prediction of any real ATS.",
    );
  });

  it('suggestion templates are byte-exact and never invite fabrication', () => {
    expect(ATS_MISS_SUGGESTION_PREFIX).toBe("No resume content matches this requirement's terms (");
    expect(ATS_MISS_SUGGESTION_SUFFIX).toBe(
      '). Add or cite real evidence in your profile, or redraft - never invent experience.',
    );
    expect(ATS_PARTIAL_SUGGESTION_PREFIX).toBe('Partially covered - unmatched terms: ');
    expect(ATS_PARTIAL_SUGGESTION_SUFFIX).toBe(
      '. Strengthen only with content your evidence actually supports.',
    );
  });

  it('thresholds are the pinned judgment consts', () => {
    expect(ATS_COVERAGE_HIT_RATIO).toBe(0.6);
    expect(ATS_COVERAGE_EVIDENCE_MAX).toBe(8);
    expect(KEYWORD_STUFFING_MIN_COUNT).toBe(4);
    expect(KEYWORD_STUFFING_DENSITY_MAX).toBe(0.05);
    expect(LENGTH_TOTAL_SHORT_WORDS).toBe(120);
    expect(LENGTH_TOTAL_LONG_WORDS).toBe(1000);
    expect(LENGTH_SUMMARY_HEAVY_SHARE).toBe(0.35);
    expect(LENGTH_SKILLS_HEAVY_SHARE).toBe(0.25);
  });

  it('the stopword set is a closed, exact-membership list (widening is test-visible)', () => {
    expect([...ATS_COVERAGE_STOPWORDS].sort()).toEqual([
      'a',
      'am',
      'an',
      'and',
      'are',
      'as',
      'at',
      'be',
      'been',
      'being',
      'but',
      'by',
      'can',
      'could',
      'did',
      'do',
      'does',
      'for',
      'from',
      'had',
      'has',
      'have',
      'in',
      'is',
      'nor',
      'of',
      'on',
      'or',
      'our',
      'should',
      'that',
      'the',
      'their',
      'these',
      'they',
      'this',
      'those',
      'to',
      'was',
      'we',
      'were',
      'will',
      'with',
      'would',
      'you',
      'your',
    ]);
    expect(ATS_COVERAGE_STOPWORDS.size).toBe(46);
    // "IT" the domain term must survive - it/its are intentionally NOT stopwords.
    expect(ATS_COVERAGE_STOPWORDS.has('it')).toBe(false);
  });
});
