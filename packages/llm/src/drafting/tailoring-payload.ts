import type {
  EvidenceStrength,
  GapClassification,
  ProjectProvenance,
  RequirementCategory,
  RequirementKind,
  ResumeEmphasisLevel,
  ResumeEntityType,
  SkillLevel,
} from '@careerforge/core';

import { EVIDENCE_PER_GAP_CAP } from './payload.ts';

// The resume-tailoring payload builder + spec validator (M2-10 §3): pure
// data-in/string-out — no DB, no provider, no clock. The ONE serialization
// site for what a tailoring call may see (ADR-0012: verified structured data
// only; the strings inside are posting/profile-DERIVED and therefore
// untrusted — the whole document enters the call solely as runPrompt's
// untrustedData, inside the random boundary markers). Entities and gaps are
// keyed by short synthetic refs (s1/e1/p1 entities, g1 gaps), not UUIDs: the
// model cites a ref, the server maps it back — no id transcription surface,
// fewer tokens. The model NEVER emits resume prose: it emits only ordering +
// emphasis + a capped rationale over these refs (fabrication is impossible by
// construction).

export interface TailoringSkillInput {
  skillId: string;
  name: string;
  level: SkillLevel;
}

export interface TailoringExperienceInput {
  experienceId: string;
  company: string;
  title: string;
  /** The experience's bullets in source order (M2-12); omit or [] = none. The
   *  model may SELECT / REORDER / OMIT these (resume-tailoring@v2), but the
   *  experience itself always renders — a job is never hidden (ADR-0012). */
  bullets?: readonly { bulletId: string; text: string }[];
}

export interface TailoringProjectInput {
  projectId: string;
  name: string;
  provenance: ProjectProvenance;
  /** The experience this project was done under, if any (SET-NULL link). */
  experienceId: string | null;
}

export interface TailoringGapInput {
  gapId: string;
  /** EFFECTIVE classification (overrides respected — tailoring is gated on a
   *  reviewed report). Unlike drafting, ALL classifications are included:
   *  'have' gaps are precisely the strengths to emphasize. */
  classification: GapClassification;
  requirementId: string;
  requirementText: string;
  requirementKind: RequirementKind;
  requirementCategory: RequirementCategory;
  rationale: string;
}

export interface TailoringEvidenceInput {
  requirementId: string;
  strength: EvidenceStrength;
  postingQuote: string;
  profileQuote: string;
  /** The profile entities this evidence links (navigation FK ids); mapped to
   *  entity refs so relevance is grounded structurally, not guessed. */
  profileSkillId: string | null;
  profileProjectId: string | null;
  profileExperienceId: string | null;
}

// Evidence quotes per gap reuse the existing drafting cap (M1-12): enough to
// ground salience, bounded token cost.

export interface TailoringPayload {
  /** The JSON document handed to runPrompt as untrustedData. */
  payload: string;
  /** s1… → skill id. */
  skillIdByRef: ReadonlyMap<string, string>;
  /** e1… → experience id. */
  experienceIdByRef: ReadonlyMap<string, string>;
  /** p1… → project id. */
  projectIdByRef: ReadonlyMap<string, string>;
  /** e1b1… → bullet id (M2-12; refs are namespaced per experience so a
   *  cross-experience bullet selection is structurally detectable). */
  bulletIdByRef: ReadonlyMap<string, string>;
  /** g1… → gap id (the citation-validation map). */
  gapIdByRef: ReadonlyMap<string, string>;
  /** skills + experiences + projects — 0 means nothing to tailor. */
  entityCount: number;
  /** gaps supplied — 0 means nothing to cite (the service 409s BEFORE any
   *  paid call when either count is 0). */
  gapCount: number;
}

/**
 * Builds the tailoring payload from verified structured inputs. Refs number
 * each collection in the given order (s1…, e1…, p1…, g1…). Evidence attaches
 * per gap via requirementId, capped at EVIDENCE_PER_GAP_CAP, and each evidence
 * item carries the entity refs it links (dropped if the entity is not in the
 * sent set). Experiences deliberately carry NO order field downstream — the
 * model can emphasize an experience but never reorder or omit one (ADR-0012).
 */
export function buildTailoringPayload(
  skills: readonly TailoringSkillInput[],
  experiences: readonly TailoringExperienceInput[],
  projects: readonly TailoringProjectInput[],
  gaps: readonly TailoringGapInput[],
  evidence: readonly TailoringEvidenceInput[],
): TailoringPayload {
  const skillIdByRef = new Map<string, string>();
  const refBySkillId = new Map<string, string>();
  const skillsJson = skills.map((skill, index) => {
    const ref = `s${String(index + 1)}`;
    skillIdByRef.set(ref, skill.skillId);
    refBySkillId.set(skill.skillId, ref);
    return { ref, name: skill.name, level: skill.level };
  });

  const experienceIdByRef = new Map<string, string>();
  const refByExperienceId = new Map<string, string>();
  // e{n}b{m} → bullet id: the model selects/reorders/omits bullets by these
  // namespaced refs, and the server maps them back (M2-12; ADR-0012 phase 2).
  const bulletIdByRef = new Map<string, string>();
  const experiencesJson = experiences.map((experience, index) => {
    const ref = `e${String(index + 1)}`;
    experienceIdByRef.set(ref, experience.experienceId);
    refByExperienceId.set(experience.experienceId, ref);
    const bullets = (experience.bullets ?? []).map((bullet, bulletIndex) => {
      const bulletRef = `${ref}b${String(bulletIndex + 1)}`;
      bulletIdByRef.set(bulletRef, bullet.bulletId);
      return { ref: bulletRef, text: bullet.text };
    });
    return { ref, company: experience.company, title: experience.title, bullets };
  });

  const projectIdByRef = new Map<string, string>();
  const refByProjectId = new Map<string, string>();
  const projectsJson = projects.map((project, index) => {
    const ref = `p${String(index + 1)}`;
    projectIdByRef.set(ref, project.projectId);
    refByProjectId.set(project.projectId, ref);
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

  const evidenceByRequirement = new Map<string, TailoringEvidenceInput[]>();
  for (const link of evidence) {
    const bucket = evidenceByRequirement.get(link.requirementId);
    if (bucket) bucket.push(link);
    else evidenceByRequirement.set(link.requirementId, [link]);
  }

  const gapIdByRef = new Map<string, string>();
  const gapsJson = gaps.map((gap, index) => {
    const ref = `g${String(index + 1)}`;
    gapIdByRef.set(ref, gap.gapId);
    return {
      ref,
      classification: gap.classification,
      kind: gap.requirementKind,
      category: gap.requirementCategory,
      requirement: gap.requirementText,
      rationale: gap.rationale,
      evidence: (evidenceByRequirement.get(gap.requirementId) ?? [])
        .slice(0, EVIDENCE_PER_GAP_CAP)
        .map((link) => {
          const entities: string[] = [];
          if (link.profileSkillId !== null) {
            const ref2 = refBySkillId.get(link.profileSkillId);
            if (ref2 !== undefined) entities.push(ref2);
          }
          if (link.profileExperienceId !== null) {
            const ref2 = refByExperienceId.get(link.profileExperienceId);
            if (ref2 !== undefined) entities.push(ref2);
          }
          if (link.profileProjectId !== null) {
            const ref2 = refByProjectId.get(link.profileProjectId);
            if (ref2 !== undefined) entities.push(ref2);
          }
          return {
            strength: link.strength,
            postingQuote: link.postingQuote,
            profileQuote: link.profileQuote,
            entities,
          };
        }),
    };
  });

  const payload = JSON.stringify(
    {
      skills: skillsJson,
      experiences: experiencesJson,
      projects: projectsJson,
      gaps: gapsJson,
    },
    null,
    2,
  );

  return {
    payload,
    skillIdByRef,
    experienceIdByRef,
    projectIdByRef,
    bulletIdByRef,
    gapIdByRef,
    entityCount: skills.length + experiences.length + projects.length,
    gapCount: gaps.length,
  };
}

/** The model's raw spec (post-schema-parse), refs still synthetic. */
export interface TailoringSpecInput {
  skillOrder: readonly string[];
  projectOrder: readonly string[];
  emphases: readonly {
    entityRef: string;
    gapRefs: readonly string[];
    emphasis: ResumeEmphasisLevel;
    reason: string;
  }[];
  /** Per-experience bullet selection/order (resume-tailoring@v2; absent on v1).
   *  Each block's bulletOrder is a SUBSET of that experience's sent bullet refs
   *  — select / reorder / OMIT (unlike skill/project orders, omission is
   *  allowed because trimming bullets per posting is honest tailoring and the
   *  experience always renders regardless). */
  experienceBulletOrders?: readonly {
    experienceRef: string;
    bulletOrder: readonly string[];
  }[];
}

/** One emphasis, refs mapped to entity id + gap ids. */
export interface MappedEmphasis {
  entityType: ResumeEntityType;
  entityId: string;
  gapIds: string[];
  emphasis: ResumeEmphasisLevel;
  reason: string;
}

/** The validated spec with every ref mapped to its UUID. */
export interface MappedTailoringSpec {
  /** skill ids in the model's order — an exact permutation of the sent
   *  skills (reorder-only, never drop). */
  skillIdOrder: string[];
  /** project ids in the model's order — an exact permutation of the sent
   *  projects. */
  projectIdOrder: string[];
  emphases: MappedEmphasis[];
  /** experienceId → selected bullet ids in the model's order (M2-12). A SUBSET
   *  of that experience's sent bullets; an experience absent from this map has
   *  no block and renders all its bullets in source order (the fail-safe
   *  default — a spec gap never silently drops content). */
  bulletIdOrderByExperienceId: Map<string, string[]>;
}

export interface TailoringSpecValidation {
  /** Defined ONLY when the spec is fully valid; undefined ⇒ persist 'flagged'
   *  with NO variant row (the M1-12 mapCitedRefs lineage). */
  spec: MappedTailoringSpec | undefined;
  /** Cited refs (an order ref, an emphasis entityRef, or a gapRef) NOT in
   *  their sent set — the layer-4 tripwire signal (value-free telemetry). */
  fabricatedRefCount: number;
  /** Sent skill/project refs ABSENT from the orders — a non-permutation:
   *  omission is misrepresentation, dropping content is a post-export human
   *  decision, never the model's (value-free telemetry). */
  missingRefCount: number;
}

const ENTITY_TYPE_BY_PREFIX: Record<string, ResumeEntityType> = {
  s: 'skill',
  e: 'experience',
  p: 'project',
};

/**
 * Validates the model's spec against the sent refs (M2-10 §3): membership
 * (every cited entity/gap ref was sent) + both-direction permutation
 * (skillOrder/projectOrder each an exact permutation of the sent refs). ANY
 * violation ⇒ spec undefined and the run persists 'flagged'. Deliberately NOT
 * required: an evidence_link on the exact (entity, gap) pair — adjacent-
 * relevance judgment is the model's residual value; the citation is the gap.
 */
export function validateTailoringSpec(
  spec: TailoringSpecInput,
  refs: {
    skillIdByRef: ReadonlyMap<string, string>;
    experienceIdByRef: ReadonlyMap<string, string>;
    projectIdByRef: ReadonlyMap<string, string>;
    /** M2-12; absent on the v1 call path (no bullet blocks to validate). */
    bulletIdByRef?: ReadonlyMap<string, string>;
    gapIdByRef: ReadonlyMap<string, string>;
  },
): TailoringSpecValidation {
  let fabricatedRefCount = 0;
  let missingRefCount = 0;

  const mapOrder = (order: readonly string[], byRef: ReadonlyMap<string, string>): string[] => {
    const ids: string[] = [];
    for (const ref of order) {
      const id = byRef.get(ref);
      if (id === undefined) fabricatedRefCount += 1;
      else ids.push(id);
    }
    // Non-permutation: any sent ref missing from the order (drop = omission).
    const present = new Set(order);
    for (const ref of byRef.keys()) {
      if (!present.has(ref)) missingRefCount += 1;
    }
    return ids;
  };

  const skillIdOrder = mapOrder(spec.skillOrder, refs.skillIdByRef);
  const projectIdOrder = mapOrder(spec.projectOrder, refs.projectIdByRef);

  const emphases: MappedEmphasis[] = [];
  for (const item of spec.emphases) {
    const entityType = ENTITY_TYPE_BY_PREFIX[item.entityRef[0] ?? ''];
    const entityMap =
      entityType === 'skill'
        ? refs.skillIdByRef
        : entityType === 'experience'
          ? refs.experienceIdByRef
          : entityType === 'project'
            ? refs.projectIdByRef
            : undefined;
    const entityId = entityMap?.get(item.entityRef);
    if (entityType === undefined || entityId === undefined) {
      fabricatedRefCount += 1;
      continue;
    }
    const gapIds: string[] = [];
    let gapFabricated = false;
    for (const gapRef of item.gapRefs) {
      const gapId = refs.gapIdByRef.get(gapRef);
      if (gapId === undefined) {
        fabricatedRefCount += 1;
        gapFabricated = true;
      } else {
        gapIds.push(gapId);
      }
    }
    if (gapFabricated) continue;
    emphases.push({ entityType, entityId, gapIds, emphasis: item.emphasis, reason: item.reason });
  }

  // Per-experience bullet selection (M2-12). Membership only — a bulletRef must
  // belong to the block's own experience (the `e{n}b…` prefix) AND have been
  // sent; a cross-experience or unsent ref is a fabrication. Omission is NOT a
  // violation (subset allowed), so bullets never touch missingRefCount. Shape
  // constraints (unique bulletOrder, one block per experience) are the v2 zod
  // schema's job, mirroring how skillOrder uniqueness lives in the schema.
  const bulletIdByRef = refs.bulletIdByRef ?? new Map<string, string>();
  const bulletIdOrderByExperienceId = new Map<string, string[]>();
  for (const block of spec.experienceBulletOrders ?? []) {
    const experienceId = refs.experienceIdByRef.get(block.experienceRef);
    if (experienceId === undefined) {
      fabricatedRefCount += 1;
      continue;
    }
    const belongsToBlock = new RegExp(`^${block.experienceRef}b\\d+$`);
    const bulletIds: string[] = [];
    let bulletFabricated = false;
    for (const bulletRef of block.bulletOrder) {
      const bulletId = bulletIdByRef.get(bulletRef);
      if (!belongsToBlock.test(bulletRef) || bulletId === undefined) {
        fabricatedRefCount += 1;
        bulletFabricated = true;
      } else {
        bulletIds.push(bulletId);
      }
    }
    if (bulletFabricated) continue;
    bulletIdOrderByExperienceId.set(experienceId, bulletIds);
  }

  const valid = fabricatedRefCount === 0 && missingRefCount === 0;
  return {
    spec: valid
      ? { skillIdOrder, projectIdOrder, emphases, bulletIdOrderByExperienceId }
      : undefined,
    fabricatedRefCount,
    missingRefCount,
  };
}
