import type {
  ClaimEvidenceSource,
  ClaimProvenanceEntities,
  ClaimProvenanceResult,
} from './index.ts';
import {
  checkClaimProvenance,
  extractNumericMentions,
  CLAIM_PROVENANCE_LAWS,
  CLAIM_SHAPE_RULES,
  NUMERIC_UNIT_MARKERS,
} from './index.ts';
import type { ResumeClaimDraft } from '@careerforge/core';
import {
  CLAIM_PROVENANCE_LAWS as CORE_CLAIM_PROVENANCE_LAWS,
  CLAIM_SHAPE_RULES as CORE_CLAIM_SHAPE_RULES,
} from '@careerforge/core';
import { describe, expect, it } from 'vitest';

// M6-02 claim-provenance gate - pure, deterministic. ALL data fictional. Tests
// are table-driven per law (L1-L6); each violation row asserts {claimIndex, law}
// precisely, plus the pinned false-positive traps and the L4 structural matrix.
// The L2-neuter row ("fabricated percent (headline)") is the sec F planted-FAIL(a)
// target: early-returning the numeric check lets a fabricated number through.

const claim = (over: Partial<ResumeClaimDraft> = {}): ResumeClaimDraft => ({
  text: 'Shipped the ingest pipeline.',
  section: 'experience',
  entityRef: 'exp-1',
  citationRefs: ['ev-1'],
  ...over,
});

const source = (over: Partial<ClaimEvidenceSource> = {}): ClaimEvidenceSource => ({
  ref: 'ev-1',
  sourceText: 'Shipped the ingest pipeline.',
  owner: { kind: 'experience', entityRef: 'exp-1' },
  provenance: 'professional',
  ...over,
});

const entities = (over: Partial<ClaimProvenanceEntities> = {}): ClaimProvenanceEntities => ({
  experiences: ['exp-1'],
  projects: ['proj-1'],
  ...over,
});

/** Run the gate with per-field overrides; unspecified fields get valid defaults
 *  so each test perturbs exactly one law. */
function run(
  over: Partial<Parameters<typeof checkClaimProvenance>[0]> = {},
): ClaimProvenanceResult {
  return checkClaimProvenance({
    claims: [claim()],
    evidence: [source()],
    entities: entities(),
    skillVocabulary: [],
    ...over,
  });
}

describe('happy paths', () => {
  it('passes a minimal valid claim', () => {
    expect(run()).toEqual({ ok: true });
  });

  it('passes a rich draft (numbers backed, skill cited, own-entity provenance)', () => {
    const result = checkClaimProvenance({
      claims: [
        claim({
          text: 'Backend engineer who cut latency 40%.',
          section: 'summary',
          entityRef: null,
          citationRefs: ['ev-sum'],
        }),
        claim({
          text: 'Shipped TypeScript services, 30% faster.',
          entityRef: 'exp-1',
          citationRefs: ['ev-exp'],
        }),
      ],
      evidence: [
        {
          ref: 'ev-sum',
          sourceText: 'Reduced latency by 40% across services.',
          owner: { kind: 'global' },
          provenance: null,
        },
        {
          ref: 'ev-exp',
          sourceText: 'Built TypeScript services; 30% faster ingest.',
          owner: { kind: 'experience', entityRef: 'exp-1' },
          provenance: 'professional',
        },
      ],
      entities: entities({ projects: [] }),
      skillVocabulary: ['TypeScript'],
    });
    expect(result).toEqual({ ok: true });
  });

  it('is vacuously ok for zero claims', () => {
    expect(run({ claims: [] })).toEqual({ ok: true });
  });
});

describe('L1 citation_membership', () => {
  it('flags a dangling citation ref', () => {
    expect(run({ claims: [claim({ citationRefs: ['nope'] })] })).toEqual({
      ok: false,
      violations: [{ claimIndex: 0, law: 'citation_membership', refs: ['nope'] }],
    });
  });

  it('flags a duplicate ref within a claim', () => {
    expect(run({ claims: [claim({ citationRefs: ['ev-1', 'ev-1'] })] })).toEqual({
      ok: false,
      violations: [{ claimIndex: 0, law: 'citation_membership', refs: ['ev-1'] }],
    });
  });
});

describe('L2 numeric + extractNumericMentions', () => {
  const markers: Array<[string, ReturnType<typeof extractNumericMentions>]> = [
    ['40%', [{ number: '40', unit: 'percent' }]],
    ['$50', [{ number: '50', unit: 'currency' }]],
    ['50 dollars', [{ number: '50', unit: 'currency' }]],
    ['usd 50', [{ number: '50', unit: 'currency' }]],
    ['1,200', [{ number: '1200', unit: null }]],
    ['1.2M', [{ number: '1.2m', unit: null }]],
    ['v2.0.1', [{ number: '2.0.1', unit: null }]],
    [
      '40-50',
      [
        { number: '40', unit: null },
        { number: '50', unit: null },
      ],
    ],
    ['40 percent', [{ number: '40', unit: 'percent' }]],
    ['401k plan', [{ number: '401k', unit: null }]],
    [
      'grew 3x and 4x',
      [
        { number: '3', unit: null },
        { number: '4', unit: null },
      ],
    ],
    ['no digits here', []],
  ];
  it.each(markers)('extracts %s', (text, expected) => {
    expect(extractNumericMentions(text)).toEqual(expected);
  });

  it('pins the marker<->unit mapping as data', () => {
    expect(NUMERIC_UNIT_MARKERS).toEqual({
      percent: { prefixSymbols: [], suffixSymbols: ['%'], words: ['percent'] },
      currency: { prefixSymbols: ['$'], suffixSymbols: [], words: ['dollars', 'usd'] },
    });
  });

  // [label, claimText, evidenceText, expected unsatisfied token | null]
  const backing: Array<[string, string, string, string | null]> = [
    ['backed percent', 'Cut latency 30%.', 'Latency cut by 30%.', null],
    ['fabricated percent (headline)', 'Boosted signups 40%.', 'Signups rose sharply.', '40'],
    ['thousands-separator equivalence', 'Handled 1,200 requests.', 'Handled 1200 requests.', null],
    ['version as-written', 'Upgraded to v2.0.1.', 'Shipped v2.0.1.', null],
    ['percent word is a compatible marker', 'Improved 40%.', 'Improved 40 percent.', null],
    ['unit-marked claim vs bare evidence flags', 'Improved 40%.', 'Improved 40 items.', '40'],
    ['decimal is not token-decomposable', 'Scored 1.2 overall.', 'Metrics were 1 and 2.', '1.2'],
    ['range endpoints both present', 'Between 40-50 users.', 'Saw 40 to 50 users.', null],
    ['range endpoint missing flags', 'Between 40-50 users.', 'Saw 40 users.', '50'],
    ['year present', 'Since 2019 we grew.', 'Founded in 2019.', null],
    ['year missing flags', 'Since 2019 we grew.', 'Founded recently.', '2019'],
    [
      'no multiplier expansion (1.2M vs 1,200,000)',
      'Reached 1.2M users.',
      'Reached 1,200,000 users.',
      '1.2m',
    ],
    ['currency backed', 'Saved $50 monthly.', 'Saved $50 per month.', null],
    ['currency word compatible', 'Saved $50 monthly.', 'Saved 50 dollars monthly.', null],
    ['no numbers is vacuous', 'Improved the pipeline.', 'Whatever prose.', null],
  ];
  it.each(backing)('%s', (_label, claimText, evidenceText, token) => {
    const result = checkClaimProvenance({
      claims: [claim({ text: claimText, section: 'summary', entityRef: null })],
      evidence: [source({ sourceText: evidenceText })],
      entities: entities(),
      skillVocabulary: [],
    });
    if (token === null) expect(result).toEqual({ ok: true });
    else
      expect(result).toEqual({ ok: false, violations: [{ claimIndex: 0, law: 'numeric', token }] });
  });
});

describe('L3 vocabulary', () => {
  // [label, claimText, evidenceText, skill, unbacked token | null]
  const rows: Array<[string, string, string, string, string | null]> = [
    [
      'skill backed by cited source',
      'Built services in TypeScript.',
      'TypeScript microservices.',
      'TypeScript',
      null,
    ],
    [
      'skill absent from evidence flags',
      'Built services in Rust.',
      'TypeScript work only.',
      'Rust',
      'Rust',
    ],
    [
      'Node.js tokenizes through punctuation',
      'Maintained the Node.js build.',
      'Our Node.js pipeline.',
      'Node.js',
      null,
    ],
    [
      'Node.js unbacked flags',
      'Maintained the Node.js build.',
      'Our Python pipeline.',
      'Node.js',
      'Node.js',
    ],
    [
      'Vue 3 multi-token phrase',
      'Led the Vue 3 migration.',
      'Vue 3 upgrade shipped.',
      'Vue 3',
      null,
    ],
    [
      'short skill Go over-flags on incidental word (pinned residual)',
      'We will go to production.',
      'Shipped the release.',
      'Go',
      'Go',
    ],
  ];
  it.each(rows)('%s', (_label, claimText, evidenceText, skill, token) => {
    const result = checkClaimProvenance({
      claims: [claim({ text: claimText, section: 'summary', entityRef: null })],
      evidence: [source({ sourceText: evidenceText })],
      entities: entities(),
      skillVocabulary: [skill],
    });
    if (token === null) expect(result).toEqual({ ok: true });
    else
      expect(result).toEqual({
        ok: false,
        violations: [{ claimIndex: 0, law: 'vocabulary', token }],
      });
  });
});

describe('L4 provenance_class matrix', () => {
  // Each row cites exactly ev-x with the given owner/provenance from the given
  // section; expects a provenance_class violation (refs: ['ev-x']) or ok.
  type Row = {
    label: string;
    section: ResumeClaimDraft['section'];
    entityRef: string | null;
    owner: ClaimEvidenceSource['owner'];
    provenance: ClaimEvidenceSource['provenance'];
    violation: boolean;
  };
  const rows: Row[] = [
    {
      label: 'experience cites own bullet',
      section: 'experience',
      entityRef: 'exp-1',
      owner: { kind: 'experience', entityRef: 'exp-1' },
      provenance: 'professional',
      violation: false,
    },
    {
      label: 'experience cites sibling experience',
      section: 'experience',
      entityRef: 'exp-1',
      owner: { kind: 'experience', entityRef: 'exp-2' },
      provenance: 'professional',
      violation: true,
    },
    {
      label: 'experience cites project evidence',
      section: 'experience',
      entityRef: 'exp-1',
      owner: { kind: 'project', entityRef: 'proj-1' },
      provenance: 'professional',
      violation: true,
    },
    {
      label: 'experience cites personal_ai_assisted via BOTH locks',
      section: 'experience',
      entityRef: 'exp-1',
      owner: { kind: 'project', entityRef: 'proj-1' },
      provenance: 'personal_ai_assisted',
      violation: true,
    },
    {
      label: 'class lock fires ALONE when ownership is satisfied',
      section: 'experience',
      entityRef: 'exp-1',
      owner: { kind: 'experience', entityRef: 'exp-1' },
      provenance: 'personal_ai_assisted',
      violation: true,
    },
    {
      label: 'project cites own project',
      section: 'project',
      entityRef: 'proj-1',
      owner: { kind: 'project', entityRef: 'proj-1' },
      provenance: 'professional',
      violation: false,
    },
    {
      label: 'project cites foreign project',
      section: 'project',
      entityRef: 'proj-1',
      owner: { kind: 'project', entityRef: 'proj-2' },
      provenance: 'professional',
      violation: true,
    },
    {
      label: 'project may cite personal evidence (class lock is experience-only)',
      section: 'project',
      entityRef: 'proj-1',
      owner: { kind: 'project', entityRef: 'proj-1' },
      provenance: 'personal_ai_assisted',
      violation: false,
    },
    {
      label: 'summary cites any evidence',
      section: 'summary',
      entityRef: null,
      owner: { kind: 'project', entityRef: 'proj-1' },
      provenance: 'personal',
      violation: false,
    },
  ];
  it.each(rows)('$label', ({ section, entityRef, owner, provenance, violation }) => {
    const result = checkClaimProvenance({
      claims: [claim({ section, entityRef, citationRefs: ['ev-x'] })],
      evidence: [source({ ref: 'ev-x', owner, provenance })],
      entities: entities({ experiences: ['exp-1'], projects: ['proj-1'] }),
      skillVocabulary: [],
    });
    if (!violation) expect(result).toEqual({ ok: true });
    else
      expect(result).toEqual({
        ok: false,
        violations: [{ claimIndex: 0, law: 'provenance_class', refs: ['ev-x'] }],
      });
  });
});

describe('L5 external_pointer', () => {
  it('flags a bare domain in claim prose', () => {
    expect(run({ claims: [claim({ text: 'See example.com for details.' })] })).toEqual({
      ok: false,
      violations: [{ claimIndex: 0, law: 'external_pointer' }],
    });
  });

  it('does NOT flag socket.io (ADR-0017 pinned negative)', () => {
    expect(run({ claims: [claim({ text: 'We use socket.io heavily.' })] })).toEqual({ ok: true });
  });
});

describe('L6 shape (per-claim + aggregate)', () => {
  it('flags a summary claim carrying an entityRef', () => {
    expect(run({ claims: [claim({ section: 'summary', entityRef: 'exp-1' })] })).toEqual({
      ok: false,
      violations: [{ claimIndex: 0, law: 'shape', detail: ['entity_ref_forbidden'] }],
    });
  });

  it('flags an entityRef not in the sent entities', () => {
    // Evidence owner matches the (unknown) entityRef so L4 passes and only shape fires.
    expect(
      run({
        claims: [claim({ entityRef: 'exp-99', citationRefs: ['ev-x'] })],
        evidence: [source({ ref: 'ev-x', owner: { kind: 'experience', entityRef: 'exp-99' } })],
      }),
    ).toEqual({
      ok: false,
      violations: [{ claimIndex: 0, law: 'shape', detail: ['entity_ref_unknown'] }],
    });
  });

  it('flags a claim text over 300 chars', () => {
    expect(run({ claims: [claim({ text: 'x'.repeat(301) })] })).toEqual({
      ok: false,
      violations: [{ claimIndex: 0, law: 'shape', detail: ['claim_text_cap'] }],
    });
  });

  it('flags the 41st claim (>40 total)', () => {
    const claims = Array.from({ length: 41 }, () =>
      claim({ text: 't', section: 'summary', entityRef: null }),
    );
    expect(run({ claims })).toEqual({
      ok: false,
      violations: [{ claimIndex: 40, law: 'shape', detail: ['claim_count_cap'] }],
    });
  });

  it('flags the 7th claim on one experience (>6)', () => {
    const claims = Array.from({ length: 7 }, () => claim({ text: 'ok', entityRef: 'exp-1' }));
    expect(run({ claims })).toEqual({
      ok: false,
      violations: [{ claimIndex: 6, law: 'shape', detail: ['experience_claim_cap'] }],
    });
  });

  it('flags the claim that crosses the 600-char summary total', () => {
    const claims = [
      claim({ text: 'a'.repeat(300), section: 'summary', entityRef: null }),
      claim({ text: 'a'.repeat(300), section: 'summary', entityRef: null }),
      claim({ text: 'a', section: 'summary', entityRef: null }),
    ];
    expect(run({ claims })).toEqual({
      ok: false,
      violations: [{ claimIndex: 2, law: 'shape', detail: ['summary_total_cap'] }],
    });
  });

  // M15-01 - the two sub-rules the pre-existing rows never reached, so all EIGHT
  // members of CLAIM_SHAPE_RULES now have a row that produces them.
  it('flags a non-summary claim with a null entityRef', () => {
    // L4 co-fires here and cannot be avoided: ownership requires the evidence's
    // owner.entityRef to EQUAL the claim's, and no owner matches null. So this
    // row asserts the full honest result - the shape sub-rule is what it pins.
    expect(run({ claims: [claim({ section: 'experience', entityRef: null })] })).toEqual({
      ok: false,
      violations: [
        { claimIndex: 0, law: 'provenance_class', refs: ['ev-1'] },
        { claimIndex: 0, law: 'shape', detail: ['entity_ref_missing'] },
      ],
    });
  });

  it('flags the 5th claim on one project (>4)', () => {
    // Evidence owned by the same project so L4 passes and only shape fires.
    const claims = Array.from({ length: 5 }, () =>
      claim({ text: 'ok', section: 'project', entityRef: 'proj-1' }),
    );
    expect(
      run({ claims, evidence: [source({ owner: { kind: 'project', entityRef: 'proj-1' } })] }),
    ).toEqual({
      ok: false,
      violations: [{ claimIndex: 4, law: 'shape', detail: ['project_claim_cap'] }],
    });
  });

  it('carries every sub-rule one claim breaks, deduped and in vocabulary order', () => {
    // Breaks two rules at once: an unknown entityRef AND a text over 300. The
    // evidence owner matches the unknown ref so L4 passes and only shape fires.
    // NOTE, honestly: the add-sites already run in CLAIM_SHAPE_RULES order, so
    // the sort and the dedupe in shapeViolatingIndices are DEFENSIVE - this row
    // pins the exact array (which would catch a future add-site reordering), it
    // does not prove a sort that currently cannot fire.
    expect(
      run({
        claims: [claim({ entityRef: 'exp-99', text: 'x'.repeat(301), citationRefs: ['ev-x'] })],
        evidence: [source({ ref: 'ev-x', owner: { kind: 'experience', entityRef: 'exp-99' } })],
      }),
    ).toEqual({
      ok: false,
      violations: [
        { claimIndex: 0, law: 'shape', detail: ['entity_ref_unknown', 'claim_text_cap'] },
      ],
    });
  });

  it('attributes an aggregate breach to the crossing claim AND every later one', () => {
    // The TRUE aggregate semantics, which the module's own doc comment used to
    // state incorrectly ("the specific claim that crosses the cap"). Four 300-char
    // summary claims: the running total is 300, 600, 900, 1200 - so claim 2 is the
    // crossing one and claim 3 is over the cap as well. Nothing on main exercised
    // multi-overflow before this row. Behavior is unchanged; only its description
    // was wrong, and changing the behavior would be a verdict change (out of scope).
    const claims = Array.from({ length: 4 }, () =>
      claim({ text: 'a'.repeat(300), section: 'summary', entityRef: null }),
    );
    expect(run({ claims })).toEqual({
      ok: false,
      violations: [
        { claimIndex: 2, law: 'shape', detail: ['summary_total_cap'] },
        { claimIndex: 3, law: 'shape', detail: ['summary_total_cap'] },
      ],
    });
  });
});

describe('M15-01 law vocabulary (order is load-bearing)', () => {
  it('pins the exact law order, not merely membership', () => {
    // `lawRank` is CLAIM_PROVENANCE_LAWS.indexOf, so this array's ORDER decides
    // how every multi-law violation set sorts. A reorder is a silent behavior
    // change, which is why this asserts the sequence rather than the set.
    expect(CLAIM_PROVENANCE_LAWS).toEqual([
      'citation_membership',
      'numeric',
      'vocabulary',
      'provenance_class',
      'external_pointer',
      'shape',
    ]);
  });

  it('pins the eight shape sub-rules in order', () => {
    expect(CLAIM_SHAPE_RULES).toEqual([
      'entity_ref_forbidden',
      'entity_ref_missing',
      'entity_ref_unknown',
      'claim_text_cap',
      'claim_count_cap',
      'experience_claim_cap',
      'project_claim_cap',
      'summary_total_cap',
    ]);
  });

  it('re-exports the vocabulary that now lives in @careerforge/core', () => {
    // D0: the definition moved to core so apps/web can type against it. Scoring
    // re-exports, so these must be the SAME arrays, not parallel copies.
    expect(CLAIM_PROVENANCE_LAWS).toBe(CORE_CLAIM_PROVENANCE_LAWS);
    expect(CLAIM_SHAPE_RULES).toBe(CORE_CLAIM_SHAPE_RULES);
  });
});

describe('violation ordering + determinism', () => {
  const multiLaw = {
    claims: [claim({ text: 'Grew to 99% via example.com.', section: 'summary', entityRef: 'x' })],
    evidence: [source()],
    entities: entities(),
    skillVocabulary: [],
  };

  it('sorts a multi-law claim by law rank', () => {
    expect(checkClaimProvenance({ ...multiLaw })).toEqual({
      ok: false,
      violations: [
        { claimIndex: 0, law: 'numeric', token: '99' },
        { claimIndex: 0, law: 'external_pointer' },
        { claimIndex: 0, law: 'shape', detail: ['entity_ref_forbidden'] },
      ],
    });
  });

  it('is deterministic (identical input twice deep-equals)', () => {
    expect(checkClaimProvenance({ ...multiLaw })).toEqual(checkClaimProvenance({ ...multiLaw }));
  });
});
