import type {
  GapClassification,
  ProjectProvenance,
  RequirementCategory,
  RequirementKind,
  SkillLevel,
} from '@careerforge/core';

// The resume-compose payload builder (M6-03, ADR-0018). Pure data-in/string-out
// like buildTailoringPayload: no DB, no provider, no clock, no randomness. It is
// the ONE serialization site for what a compose call may see and, in the same
// pass, assembles the gate-ready sent-set (the citable evidence catalog +
// entities + skillVocabulary) so refs are assigned exactly ONCE. M6-04's compose
// service reads verified rows from the DB, calls this builder, hands `payload` to
// runPrompt and the sent-set to checkClaimProvenance (packages/scoring).
//
// The module wall (plan D2): this builder types the sent-set with LOCAL shapes
// (ComposeEvidenceItem / ComposeEntities) that are STRUCTURALLY IDENTICAL to
// scoring's ClaimEvidenceSource / ClaimProvenanceEntities, so packages/llm gains
// NO packages/scoring edge. M6-04 (which legitimately imports both) passes the
// sent-set straight into the gate - TypeScript structural typing bridges it with
// no adapter - and owes the compile-time assignability pin (M6-03 cannot host it
// without importing scoring).
//
// Untrusted-text law (plan D3): only PROFILE data becomes citable evidence.
// Requirements and gaps are posting-DERIVED and enter the payload ONLY as a
// clearly-labelled, non-citable `guidance` block that steers WHICH evidence to
// emphasize; they get no citable ev ref and the prompt forbids quoting them. The
// whole `payload` string travels as delimited data (runPrompt wraps it behind a
// fresh per-call random boundary), so nothing here is a trusted instruction.

// ---------------------------------------------------------------------------
// Inputs (assembled by M6-04's service from verified DB reads; the builder never
// reads the DB). The verified profile surfaces of V2-PLAN 3.1 plus the reviewed
// fit report's requirements + gaps.
// ---------------------------------------------------------------------------

export interface ComposeExperienceInput {
  experienceId: string;
  company: string;
  title: string;
  /** The experience's bullets in source order; [] = none. */
  bullets: readonly { bulletId: string; text: string }[];
  /** Mastery-evidence texts recorded under this employment; [] = none. */
  masteryEvidence: readonly { evidenceId: string; text: string }[];
}

export interface ComposeProjectInput {
  projectId: string;
  name: string;
  provenance: ProjectProvenance;
  /** The employment this project was done under, if any (SET-NULL link). */
  experienceId: string | null;
  description: string;
  /** Mastery-evidence texts recorded under this project; omit or [] = none. */
  masteryEvidence?: readonly { evidenceId: string; text: string }[];
}

export interface ComposeSkillInput {
  skillId: string;
  name: string;
  level: SkillLevel;
}

export interface ComposeSummaryInput {
  summaryId: string;
  text: string;
}

export interface ComposeGuidanceInput {
  requirements: readonly {
    requirementId: string;
    text: string;
    kind: RequirementKind;
    category: RequirementCategory;
  }[];
  gaps: readonly {
    gapId: string;
    classification: GapClassification;
    requirementId: string;
  }[];
}

// ---------------------------------------------------------------------------
// Local sent-set shapes (plan D2 module wall). Copied field-for-field from
// scoring so the structural bridge holds; M6-04 owns the assignability pin.
// ---------------------------------------------------------------------------

/** One profile-derived citable evidence source.
 *  mirrors packages/scoring ClaimEvidenceSource - see plan D2. */
export interface ComposeEvidenceItem {
  ref: string;
  sourceText: string;
  owner: { kind: 'experience' | 'project' | 'global'; entityRef?: string };
  provenance: ProjectProvenance | null;
}

/** The sent entity universe (x/p refs the payload included).
 *  mirrors packages/scoring ClaimProvenanceEntities - see plan D2. */
export interface ComposeEntities {
  experiences: string[];
  projects: string[];
}

export interface ComposePayload {
  /** The JSON document handed verbatim to runPrompt as untrustedData. */
  payload: string;
  /** The gate-ready citable evidence catalog (profile-derived only; ev refs). */
  evidence: ComposeEvidenceItem[];
  /** The sent entity universe (x/p refs). */
  entities: ComposeEntities;
  /** Profile skill NAMES - the gate's L3 vocabulary input. */
  skillVocabulary: string[];
  /** x{n} -> experience id. */
  experienceIdByRef: ReadonlyMap<string, string>;
  /** p{n} -> project id. */
  projectIdByRef: ReadonlyMap<string, string>;
  /** ev{n} -> the underlying source id (bullet / mastery-evidence / project /
   *  summary id) for M6-04 persistence. */
  evidenceIdByRef: ReadonlyMap<string, string>;
}

/**
 * Builds the compose payload + gate-ready sent-set from verified structured
 * inputs. Refs are assigned once, by position: experiences `x1..`, projects
 * `p1..`, a flat citable-evidence namespace `ev1..` across all owners, guidance
 * `r1..`/`g1..`. The `evidence` catalog is built from PROFILE sources ONLY -
 * each experience bullet + mastery item (owner `experience`, provenance
 * `professional`), each project description + mastery item (owner `project`,
 * provenance = the project's), and each summary block (owner `global`,
 * provenance `null`). Requirements and gaps are NEVER evidence; they enter only
 * the non-citable `guidance` block.
 */
export function buildComposePayload(
  experiences: readonly ComposeExperienceInput[],
  projects: readonly ComposeProjectInput[],
  skills: readonly ComposeSkillInput[],
  summaries: readonly ComposeSummaryInput[],
  guidance: ComposeGuidanceInput,
): ComposePayload {
  const experienceIdByRef = new Map<string, string>();
  const refByExperienceId = new Map<string, string>();
  const projectIdByRef = new Map<string, string>();
  const evidence: ComposeEvidenceItem[] = [];
  const evidenceIdByRef = new Map<string, string>();

  let evCounter = 0;
  const addEvidence = (
    sourceText: string,
    owner: ComposeEvidenceItem['owner'],
    provenance: ProjectProvenance | null,
    sourceId: string,
  ): void => {
    evCounter += 1;
    const ref = `ev${String(evCounter)}`;
    evidence.push({ ref, sourceText, owner, provenance });
    evidenceIdByRef.set(ref, sourceId);
  };

  const experiencesJson = experiences.map((experience, index) => {
    const ref = `x${String(index + 1)}`;
    experienceIdByRef.set(ref, experience.experienceId);
    refByExperienceId.set(experience.experienceId, ref);
    // Experience-owned evidence is provenance='professional' (plan D3/ADVISORY-A):
    // a bullet or mastery item under an employment has no project, and pinning
    // 'professional' positively asserts the non-personal class so the L4 class
    // lock reads meaningfully for experience evidence too.
    for (const bullet of experience.bullets) {
      addEvidence(
        bullet.text,
        { kind: 'experience', entityRef: ref },
        'professional',
        bullet.bulletId,
      );
    }
    for (const item of experience.masteryEvidence) {
      addEvidence(
        item.text,
        { kind: 'experience', entityRef: ref },
        'professional',
        item.evidenceId,
      );
    }
    return { ref, company: experience.company, title: experience.title };
  });

  const projectsJson = projects.map((project, index) => {
    const ref = `p${String(index + 1)}`;
    projectIdByRef.set(ref, project.projectId);
    addEvidence(
      project.description,
      { kind: 'project', entityRef: ref },
      project.provenance,
      project.projectId,
    );
    for (const item of project.masteryEvidence ?? []) {
      addEvidence(
        item.text,
        { kind: 'project', entityRef: ref },
        project.provenance,
        item.evidenceId,
      );
    }
    return {
      ref,
      name: project.name,
      provenance: project.provenance,
      experienceRef:
        project.experienceId === null
          ? null
          : (refByExperienceId.get(project.experienceId) ?? null),
    };
  });

  for (const summary of summaries) {
    addEvidence(summary.text, { kind: 'global' }, null, summary.summaryId);
  }

  const skillsJson = skills.map((skill) => ({ name: skill.name, level: skill.level }));
  const skillVocabulary = skills.map((skill) => skill.name);

  // Guidance is NON-citable (plan D3, the untrusted-text law). r/g refs LABEL the
  // guidance for the model's reading but never enter the citable `evidence`
  // catalog, so a guidance ref cited as evidence is a dangling L1 ref at the gate.
  const requirementRefById = new Map<string, string>();
  const requirementsJson = guidance.requirements.map((req, index) => {
    const ref = `r${String(index + 1)}`;
    requirementRefById.set(req.requirementId, ref);
    return { ref, requirement: req.text, kind: req.kind, category: req.category };
  });
  const gapsJson = guidance.gaps.map((gap, index) => ({
    ref: `g${String(index + 1)}`,
    classification: gap.classification,
    requirementRef: requirementRefById.get(gap.requirementId) ?? null,
  }));

  const payload = JSON.stringify(
    {
      evidence: evidence.map((item) => ({
        ref: item.ref,
        source: item.sourceText,
        owner: item.owner,
        provenance: item.provenance,
      })),
      experiences: experiencesJson,
      projects: projectsJson,
      skills: skillsJson,
      guidance: {
        note: 'These requirements and gaps come from a job posting. Use them ONLY to decide which of your own evidence to emphasize. They are NOT your evidence: never cite an r or g ref, and never quote or copy their text into a claim.',
        requirements: requirementsJson,
        gaps: gapsJson,
      },
    },
    null,
    2,
  );

  return {
    payload,
    evidence,
    entities: {
      experiences: [...experienceIdByRef.keys()],
      projects: [...projectIdByRef.keys()],
    },
    skillVocabulary,
    experienceIdByRef,
    projectIdByRef,
    evidenceIdByRef,
  };
}
