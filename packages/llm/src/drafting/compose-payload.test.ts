import { describe, expect, it } from 'vitest';

import {
  buildComposePayload,
  type ComposeExperienceInput,
  type ComposeGuidanceInput,
  type ComposeProjectInput,
  type ComposeSkillInput,
  type ComposeSummaryInput,
} from './compose-payload.ts';

// All fixture data is fictional (RISKS P-01) - the Nova Okafor persona.

const EXPERIENCES: readonly ComposeExperienceInput[] = [
  {
    experienceId: 'exp-1',
    company: 'Meridian Robotics Co.',
    title: 'Staff Engineer',
    bullets: [{ bulletId: 'b-1', text: 'BULLET-CANARY led a fictional platform migration.' }],
    masteryEvidence: [{ evidenceId: 'm-1', text: 'MASTERY-CANARY drove a fictional rollout.' }],
  },
];

const PROJECTS: readonly ComposeProjectInput[] = [
  {
    projectId: 'proj-1',
    name: 'Aurora CLI',
    provenance: 'personal',
    experienceId: null,
    description: 'PROJECT-CANARY a fictional command-line tool.',
    masteryEvidence: [
      { evidenceId: 'pm-1', text: 'PROJECT-MASTERY-CANARY shipped a fictional release.' },
    ],
  },
];

const SKILLS: readonly ComposeSkillInput[] = [
  { skillId: 'sk-ts', name: 'TypeScript', level: 'expert' },
  { skillId: 'sk-go', name: 'Go', level: 'solid' },
];

const SUMMARIES: readonly ComposeSummaryInput[] = [
  { summaryId: 'sum-1', text: 'SUMMARY-CANARY a fictional professional summary block.' },
];

const GUIDANCE: ComposeGuidanceInput = {
  requirements: [
    {
      requirementId: 'req-1',
      text: 'REQ-CANARY Kubernetes operations at scale',
      kind: 'must_have',
      category: 'other',
    },
  ],
  gaps: [{ gapId: 'gap-1', classification: 'genuine_gap', requirementId: 'req-1' }],
};

const build = () => buildComposePayload(EXPERIENCES, PROJECTS, SKILLS, SUMMARIES, GUIDANCE);

describe('buildComposePayload', () => {
  it('assigns entity refs by position and round-trips them to ids', () => {
    const built = build();
    expect([...built.experienceIdByRef.entries()]).toEqual([['x1', 'exp-1']]);
    expect([...built.projectIdByRef.entries()]).toEqual([['p1', 'proj-1']]);
    expect(built.entities).toEqual({ experiences: ['x1'], projects: ['p1'] });
  });

  it('assigns a flat ev namespace across all owners, each ref unique, mapped to its source id', () => {
    const built = build();
    const refs = built.evidence.map((item) => item.ref);
    // bullet, mastery, project description, project mastery, summary = 5 items.
    expect(refs).toEqual(['ev1', 'ev2', 'ev3', 'ev4', 'ev5']);
    expect(new Set(refs).size).toBe(refs.length);
    expect([...built.evidenceIdByRef.entries()]).toEqual([
      ['ev1', 'b-1'],
      ['ev2', 'm-1'],
      ['ev3', 'proj-1'],
      ['ev4', 'pm-1'],
      ['ev5', 'sum-1'],
    ]);
  });

  it('pins owner + provenance per source (experience=professional, project=its provenance, summary=global/null)', () => {
    const byRef = new Map(build().evidence.map((item) => [item.ref, item]));
    // experience bullet + mastery: owner experience/x1, provenance professional (D3/ADVISORY-A).
    expect(byRef.get('ev1')).toMatchObject({
      owner: { kind: 'experience', entityRef: 'x1' },
      provenance: 'professional',
    });
    expect(byRef.get('ev2')).toMatchObject({
      owner: { kind: 'experience', entityRef: 'x1' },
      provenance: 'professional',
    });
    // personal project description + mastery: owner project/p1, provenance personal.
    expect(byRef.get('ev3')).toMatchObject({
      owner: { kind: 'project', entityRef: 'p1' },
      provenance: 'personal',
    });
    expect(byRef.get('ev4')).toMatchObject({
      owner: { kind: 'project', entityRef: 'p1' },
      provenance: 'personal',
    });
    // summary: owner global (no entityRef), provenance null.
    expect(byRef.get('ev5')?.owner).toEqual({ kind: 'global' });
    expect(byRef.get('ev5')?.provenance).toBeNull();
  });

  it('skillVocabulary equals the skill names in order', () => {
    expect(build().skillVocabulary).toEqual(['TypeScript', 'Go']);
  });

  it('the citable evidence catalog carries ONLY profile text - never a requirement or gap (the untrusted-text guarantee)', () => {
    const built = build();
    for (const item of built.evidence) {
      expect(item.sourceText).not.toContain('REQ-CANARY');
      // no evidence item carries a guidance (r/g) ref - the namespace is ev only.
      expect(item.ref).toMatch(/^ev\d+$/);
    }
  });

  it('guidance appears in the payload string but never as a citable ev ref', () => {
    const built = build();
    // Requirement text is present as guidance (steers emphasis)...
    expect(built.payload).toContain('REQ-CANARY');
    const parsed = JSON.parse(built.payload) as {
      evidence: { ref: string; source: string }[];
      guidance: {
        requirements: { ref: string }[];
        gaps: { ref: string; requirementRef: string }[];
      };
    };
    // ...but it lives under guidance with r/g refs, and no evidence entry echoes it.
    expect(parsed.guidance.requirements[0]?.ref).toBe('r1');
    expect(parsed.guidance.gaps[0]).toMatchObject({ ref: 'g1', requirementRef: 'r1' });
    expect(parsed.evidence.every((e) => e.ref.startsWith('ev'))).toBe(true);
    expect(parsed.evidence.some((e) => e.source.includes('REQ-CANARY'))).toBe(false);
  });

  it('serializes profile evidence with an owner + provenance hint so the model can obey L4', () => {
    const parsed = JSON.parse(build().payload) as {
      evidence: {
        ref: string;
        owner: { kind: string; entityRef?: string };
        provenance: string | null;
      }[];
    };
    const ev1 = parsed.evidence.find((e) => e.ref === 'ev1');
    expect(ev1?.owner).toEqual({ kind: 'experience', entityRef: 'x1' });
    expect(ev1?.provenance).toBe('professional');
  });

  it('links a project to its parent experience by ref (structurally), null when unlinked', () => {
    const linked = buildComposePayload(
      EXPERIENCES,
      [{ ...PROJECTS[0]!, experienceId: 'exp-1' }],
      SKILLS,
      SUMMARIES,
      GUIDANCE,
    );
    const parsed = JSON.parse(linked.payload) as { projects: { experienceRef: string | null }[] };
    expect(parsed.projects[0]?.experienceRef).toBe('x1');
    // unlinked (the base fixture): null
    const parsedBase = JSON.parse(build().payload) as {
      projects: { experienceRef: string | null }[];
    };
    expect(parsedBase.projects[0]?.experienceRef).toBeNull();
  });

  it('an experience with no bullets or mastery contributes no evidence', () => {
    const built = buildComposePayload(
      [
        {
          experienceId: 'exp-bare',
          company: 'Bare Co.',
          title: 'Engineer',
          bullets: [],
          masteryEvidence: [],
        },
      ],
      [],
      [],
      [],
      { requirements: [], gaps: [] },
    );
    expect(built.evidence).toEqual([]);
    expect(built.entities).toEqual({ experiences: ['x1'], projects: [] });
  });
});
