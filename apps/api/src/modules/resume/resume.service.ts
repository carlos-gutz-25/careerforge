import {
  renderResumeVariantMarkdown,
  type FitReportResumeVariantResponse,
  type ProjectProvenance,
  type ResumeRenderCitation,
  type ResumeRenderEntry,
  type ResumeVariantEntry,
  type ResumeVariantResponse,
  type ResumeVariantReviewResponse,
  type ResumeVariantRun,
} from '@careerforge/core';
import {
  type GapsRepository,
  type ProfileRepository,
  type ResumeVariantEntryInsert,
  type ResumeVariantInsert,
  type ResumeVariantRunInsert,
  type ResumeVariantRunRow,
  type ResumeVariantsRepository,
  type VariantEntryWithCitations,
  type VariantWithEntries,
} from '@careerforge/db';
import {
  buildTailoringPayload,
  resumeTailoringV1,
  runPrompt,
  validateTailoringSpec,
  type LlmCallRecord,
  type LlmProvider,
  type MappedEmphasis,
  type TailoringEvidenceInput,
  type TailoringGapInput,
} from '@careerforge/llm';

import { stripNulChars, toPlainJson } from '../extraction/extraction.service.ts';

// M2-10: the resume-tailoring module. Mirrors the plans service (the M1-12
// twin) with tailoring-specific deltas: ALL gap classifications reach the
// payload, spec validation replaces citation validation, the deterministic
// renderer produces a stored markdown snapshot, and a review-gated export
// serves that snapshot byte-for-byte. Error classes live with the service
// (the A1 precedent). Nothing here logs labels, reasons, quotes, or markdown.

export class ReportNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('fit report not found');
  }
}

export class ReportNotReviewedError extends Error {
  readonly statusCode = 409;
  readonly code = 'REPORT_NOT_REVIEWED';
  constructor() {
    super('fit report is still a draft — review it before tailoring a resume variant');
  }
}

export class NothingToTailorError extends Error {
  readonly statusCode = 409;
  readonly code = 'NOTHING_TO_TAILOR';
  constructor() {
    super('the report has no profile entities or no gaps — nothing to tailor');
  }
}

export class VariantNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('resume variant not found');
  }
}

export class VariantAlreadyReviewedError extends Error {
  readonly statusCode = 409;
  readonly code = 'VARIANT_ALREADY_REVIEWED';
  constructor() {
    super('resume variant is already reviewed');
  }
}

export class VariantNotReviewedError extends Error {
  readonly statusCode = 409;
  readonly code = 'VARIANT_NOT_REVIEWED';
  constructor() {
    super('resume variant is still a draft — review it before exporting');
  }
}

export class LlmNotConfiguredError extends Error {
  readonly statusCode = 503;
  readonly code = 'LLM_NOT_CONFIGURED';
  constructor() {
    super('no LLM provider configured — set ANTHROPIC_API_KEY');
  }
}

export class LlmUpstreamError extends Error {
  readonly statusCode = 502;
  readonly code = 'LLM_UPSTREAM_ERROR';
  constructor(errorName: string, auditNote: string) {
    super(`LLM provider call failed: ${errorName}${auditNote}`);
  }
}

export interface VariantDraftResult {
  response: FitReportResumeVariantResponse;
  /** false = existing variant served, no LLM call (HTTP 200); true = fresh
   *  wire call(s) persisted (HTTP 201 — including non-ok/flagged terminals). */
  created: boolean;
  /** Route-log telemetry (value-free): refs the model fabricated / dropped —
   *  > 0 iff the run landed 'flagged'. */
  fabricatedRefCount: number;
  missingRefCount: number;
}

export interface VariantExportResult {
  filename: string;
  markdown: string;
}

export interface ResumeService {
  draft(userId: string, reportId: string): Promise<VariantDraftResult>;
  getVariant(userId: string, reportId: string): Promise<FitReportResumeVariantResponse>;
  review(
    userId: string,
    variantId: string,
    notes: string | null | undefined,
  ): Promise<ResumeVariantReviewResponse>;
  export(userId: string, variantId: string): Promise<VariantExportResult>;
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toInsert(record: LlmCallRecord): ResumeVariantRunInsert {
  return {
    promptId: record.promptId,
    provider: record.provider,
    model: record.model,
    rawResponse: stripNulChars(toPlainJson(record.rawResponse)),
    inputTokens: record.usage.inputTokens,
    outputTokens: record.usage.outputTokens,
    cacheReadInputTokens: record.usage.cacheReadInputTokens,
    cacheCreationInputTokens: record.usage.cacheCreationInputTokens,
    latencyMs: record.latencyMs,
    attempt: record.attempt,
    status: record.status,
    createdAt: new Date(record.timestamp),
  };
}

function toWireRun(row: ResumeVariantRunRow): ResumeVariantRun {
  return {
    id: row.id,
    promptId: row.promptId,
    provider: row.provider,
    model: row.model,
    status: row.status,
    attempt: row.attempt,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cacheReadInputTokens: row.cacheReadInputTokens,
    cacheCreationInputTokens: row.cacheCreationInputTokens,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Join row → the ONE entry wire contract. Label/detail are durable snapshots;
 *  reason is LLM-generated and the citation display fields are posting-derived:
 *  UNTRUSTED on display. */
function toWireEntry(row: VariantEntryWithCitations): ResumeVariantEntry {
  return {
    id: row.entry.id,
    section: row.entry.section,
    position: row.entry.position,
    label: row.entry.label,
    detail: row.entry.detail,
    emphasis: row.entry.emphasis,
    reason: row.entry.reason,
    citations: row.citations.map((citation) => ({
      gapId: citation.citation.gapId,
      gapClassification: citation.gapClassification,
      requirementId: citation.requirementId,
      requirementText: citation.requirementText,
      requirementKind: citation.requirementKind,
      requirementCategory: citation.requirementCategory,
    })),
  };
}

function toWireVariant(stored: VariantWithEntries): ResumeVariantResponse {
  return {
    id: stored.variant.id,
    fitReportId: stored.variant.fitReportId,
    reviewStatus: stored.variant.reviewStatus,
    notes: stored.variant.notes,
    createdAt: stored.variant.createdAt.toISOString(),
    renderedMarkdown: stored.variant.renderedMarkdown,
    entries: stored.entries.map(toWireEntry),
  };
}

const PROVENANCE_DISPLAY: Record<ProjectProvenance, string> = {
  professional: 'professional',
  personal: 'personal',
  personal_ai_assisted: 'personal, AI-assisted',
};

function skillDetail(skill: { level: string; years: number | null; lastUsed: string | null }) {
  const parts = [skill.level];
  if (skill.years !== null) parts.push(`${String(skill.years)} yrs`);
  if (skill.lastUsed !== null) parts.push(`last used ${skill.lastUsed}`);
  return parts.join(' · ');
}

function experienceDetail(experience: { startDate: string; endDate: string | null }) {
  const start = experience.startDate.slice(0, 4);
  const end = experience.endDate === null ? 'present' : experience.endDate.slice(0, 4);
  return `${start} - ${end}`;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function createResumeService(deps: {
  variants: ResumeVariantsRepository;
  gaps: GapsRepository;
  profile: ProfileRepository;
  provider: LlmProvider | undefined;
  now?: () => number;
}): ResumeService {
  const { variants, gaps, profile, provider } = deps;
  const prompt = resumeTailoringV1;

  return {
    async draft(userId, reportId) {
      const report = await variants.findReportById(userId, reportId);
      if (!report) throw new ReportNotFoundError();
      if (report.reviewStatus !== 'reviewed') throw new ReportNotReviewedError();

      // UNIQUE-as-cache: an existing variant is served with no LLM call.
      const existing = await variants.findVariantForReport(userId, reportId);
      if (existing) {
        return {
          response: {
            run: toWireRun(existing.run),
            variant: toWireVariant(existing),
            cached: true,
          },
          created: false,
          fabricatedRefCount: 0,
          missingRefCount: 0,
        };
      }

      // Tailoring inputs: profile entities, the report's gap set (ALL
      // classifications — 'have' gaps are strengths), and tailoring evidence.
      const profileData = await profile.getProfile(userId);
      const gapSet = await gaps.findGapsForReport(userId, reportId);
      if (!gapSet) throw new ReportNotFoundError();
      const gapInputs: TailoringGapInput[] = gapSet.rows.map((row) => ({
        gapId: row.gap.id,
        classification: row.gap.classification,
        requirementId: row.gap.requirementId,
        requirementText: row.requirementText,
        requirementKind: row.requirementKind,
        requirementCategory: row.requirementCategory,
        rationale: row.gap.rationale,
      }));
      const evidenceInputs: TailoringEvidenceInput[] =
        await variants.findTailoringEvidenceForReport(userId, reportId);

      const built = buildTailoringPayload(
        profileData.skills.map((skill) => ({
          skillId: skill.id,
          name: skill.name,
          level: skill.level,
        })),
        profileData.experiences.map((experience) => ({
          experienceId: experience.id,
          company: experience.company,
          title: experience.title,
        })),
        profileData.projects.map((project) => ({
          projectId: project.id,
          name: project.name,
          provenance: project.provenance,
          experienceId: project.experienceId,
        })),
        gapInputs,
        evidenceInputs,
      );
      // Nothing to tailor → 409 BEFORE any paid call.
      if (built.entityCount === 0 || built.gapCount === 0) throw new NothingToTailorError();

      if (!provider) throw new LlmNotConfiguredError();

      const records: LlmCallRecord[] = [];
      let result;
      try {
        result = await runPrompt(
          prompt,
          { untrustedData: built.payload },
          {
            provider,
            recordCall: (record) => {
              records.push(record);
            },
            ...(deps.now ? { now: deps.now } : {}),
          },
        );
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'unknown';
        let auditNote = '';
        try {
          await variants.persistTailoringOutcome(
            userId,
            reportId,
            records.map(toInsert),
            false,
            undefined,
          );
        } catch {
          auditNote = ` (audit record persistence also failed; ${String(records.length)} record(s) lost)`;
        }
        throw new LlmUpstreamError(errorName, auditNote);
      }

      // Spec validation (the layer-4 analog): membership + both-direction
      // permutation. ANY violation ⇒ the run lands 'flagged' via the
      // repository's single policy site, NO variant row. No auto-retry.
      let variantInsert: ResumeVariantInsert | undefined;
      let specInvalid = false;
      let fabricatedRefCount = 0;
      let missingRefCount = 0;
      if (result.status === 'ok') {
        const validation = validateTailoringSpec(result.output, {
          skillIdByRef: built.skillIdByRef,
          experienceIdByRef: built.experienceIdByRef,
          projectIdByRef: built.projectIdByRef,
          gapIdByRef: built.gapIdByRef,
        });
        fabricatedRefCount = validation.fabricatedRefCount;
        missingRefCount = validation.missingRefCount;
        if (validation.spec === undefined) {
          specInvalid = true;
        } else {
          variantInsert = buildVariantInsert(
            validation.spec,
            profileData,
            gapInputs,
            evidenceInputs,
            reportId,
            isoDate(deps.now?.() ?? Date.now()),
          );
        }
      }

      const outcome = await variants.persistTailoringOutcome(
        userId,
        reportId,
        records.map(toInsert),
        specInvalid,
        variantInsert,
      );

      if (outcome.conflicted) {
        const winner = await variants.findVariantForReport(userId, reportId);
        if (!winner) throw new Error('conflicted persist but no variant found');
        return {
          response: { run: toWireRun(winner.run), variant: toWireVariant(winner), cached: true },
          created: false,
          fabricatedRefCount,
          missingRefCount,
        };
      }

      if (outcome.variantCreated) {
        const stored = await variants.findVariantForReport(userId, reportId);
        if (!stored) throw new Error('variant persisted but not readable');
        return {
          response: { run: toWireRun(stored.run), variant: toWireVariant(stored), cached: false },
          created: true,
          fabricatedRefCount,
          missingRefCount,
        };
      }

      const finalRun = outcome.runs[outcome.runs.length - 1];
      if (!finalRun) throw new Error('tailoring persisted no runs');
      return {
        response: { run: toWireRun(finalRun), variant: null, cached: false },
        created: true,
        fabricatedRefCount,
        missingRefCount,
      };
    },

    async getVariant(userId, reportId) {
      const report = await variants.findReportById(userId, reportId);
      if (!report) throw new ReportNotFoundError();
      const stored = await variants.findVariantForReport(userId, reportId);
      if (stored) {
        return { run: toWireRun(stored.run), variant: toWireVariant(stored), cached: false };
      }
      const latest = await variants.findLatestRunForReport(userId, reportId);
      return { run: latest ? toWireRun(latest) : null, variant: null, cached: false };
    },

    async review(userId, variantId, notes) {
      const outcome = await variants.markVariantReviewed(userId, variantId, trimmedOrNull(notes));
      if (outcome.kind === 'not_found') throw new VariantNotFoundError();
      if (outcome.kind === 'already_reviewed') throw new VariantAlreadyReviewedError();
      return {
        id: outcome.variant.id,
        reviewStatus: outcome.variant.reviewStatus,
        notes: outcome.variant.notes,
      };
    },

    async export(userId, variantId) {
      const variant = await variants.findVariantById(userId, variantId);
      if (!variant) throw new VariantNotFoundError();
      if (variant.reviewStatus !== 'reviewed') throw new VariantNotReviewedError();
      return {
        filename: `resume-variant-${variant.id}.md`,
        markdown: variant.renderedMarkdown,
      };
    },
  };

  /** Builds the render input + persist entries from the validated spec and the
   *  profile/gap/evidence data. Positions are server-assigned: skills/projects
   *  from spec order, experiences from DB chronological order (getProfile's
   *  newest-first). Renders the markdown snapshot once. */
  function buildVariantInsert(
    spec: {
      skillIdOrder: string[];
      projectIdOrder: string[];
      emphases: MappedEmphasis[];
    },
    profileData: Awaited<ReturnType<ProfileRepository['getProfile']>>,
    gapInputs: TailoringGapInput[],
    evidence: TailoringEvidenceInput[],
    fitReportId: string,
    generatedDate: string,
  ): ResumeVariantInsert {
    const skillById = new Map(profileData.skills.map((skill) => [skill.id, skill]));
    const projectById = new Map(profileData.projects.map((project) => [project.id, project]));
    const emphasisByEntity = new Map(spec.emphases.map((item) => [item.entityId, item]));
    const gapById = new Map(gapInputs.map((gap) => [gap.gapId, gap]));
    const evidenceByRequirement = new Map<string, TailoringEvidenceInput[]>();
    for (const link of evidence) {
      const bucket = evidenceByRequirement.get(link.requirementId);
      if (bucket) bucket.push(link);
      else evidenceByRequirement.set(link.requirementId, [link]);
    }

    const buildCitations = (gapIds: string[]): ResumeRenderCitation[] =>
      gapIds.flatMap((gapId) => {
        const gap = gapById.get(gapId);
        if (!gap) return [];
        return [
          {
            requirementText: gap.requirementText,
            requirementKind: gap.requirementKind,
            requirementCategory: gap.requirementCategory,
            classification: gap.classification,
            evidence: (evidenceByRequirement.get(gap.requirementId) ?? []).map((link) => ({
              strength: link.strength,
              postingQuote: link.postingQuote,
              profileQuote: link.profileQuote,
            })),
          },
        ];
      });

    const renderEntries: ResumeRenderEntry[] = [];
    const persistEntries: ResumeVariantEntryInsert[] = [];

    const pushEntry = (
      render: ResumeRenderEntry,
      persist: Omit<ResumeVariantEntryInsert, 'citationGapIds'>,
      gapIds: string[],
    ) => {
      renderEntries.push(render);
      persistEntries.push({ ...persist, citationGapIds: gapIds });
    };

    // Skills — spec order.
    spec.skillIdOrder.forEach((skillId, position) => {
      const skill = skillById.get(skillId);
      if (!skill) return;
      const emphasis = emphasisByEntity.get(skillId);
      const label = skill.name;
      const detail = skillDetail(skill);
      pushEntry(
        {
          section: 'skill',
          label,
          detail,
          emphasis: emphasis?.emphasis ?? null,
          reason: emphasis?.reason ?? null,
          citations: emphasis ? buildCitations(emphasis.gapIds) : [],
        },
        {
          section: 'skill',
          position,
          profileSkillId: skillId,
          profileProjectId: null,
          profileExperienceId: null,
          label,
          detail,
          emphasis: emphasis?.emphasis ?? null,
          reason: emphasis?.reason ?? null,
        },
        emphasis?.gapIds ?? [],
      );
    });

    // Experiences — DB chronological order (never reordered/omitted).
    profileData.experiences.forEach((experience, position) => {
      const emphasis = emphasisByEntity.get(experience.id);
      const label = `${experience.company}, ${experience.title}`;
      const detail = experienceDetail(experience);
      pushEntry(
        {
          section: 'experience',
          label,
          detail,
          emphasis: emphasis?.emphasis ?? null,
          reason: emphasis?.reason ?? null,
          citations: emphasis ? buildCitations(emphasis.gapIds) : [],
        },
        {
          section: 'experience',
          position,
          profileSkillId: null,
          profileProjectId: null,
          profileExperienceId: experience.id,
          label,
          detail,
          emphasis: emphasis?.emphasis ?? null,
          reason: emphasis?.reason ?? null,
        },
        emphasis?.gapIds ?? [],
      );
    });

    // Projects — spec order; provenance folded into the label (honest-labeling).
    spec.projectIdOrder.forEach((projectId, position) => {
      const project = projectById.get(projectId);
      if (!project) return;
      const emphasis = emphasisByEntity.get(projectId);
      const label = `${project.name} (${PROVENANCE_DISPLAY[project.provenance]})`;
      const detail = project.summary;
      pushEntry(
        {
          section: 'project',
          label,
          detail,
          emphasis: emphasis?.emphasis ?? null,
          reason: emphasis?.reason ?? null,
          citations: emphasis ? buildCitations(emphasis.gapIds) : [],
        },
        {
          section: 'project',
          position,
          profileSkillId: null,
          profileProjectId: projectId,
          profileExperienceId: null,
          label,
          detail,
          emphasis: emphasis?.emphasis ?? null,
          reason: emphasis?.reason ?? null,
        },
        emphasis?.gapIds ?? [],
      );
    });

    const renderedMarkdown = renderResumeVariantMarkdown({
      fitReportId,
      generatedDate,
      entries: renderEntries,
    });
    return { renderedMarkdown, entries: persistEntries };
  }
}
