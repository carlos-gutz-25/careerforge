import {
  type AggregateTrimDisclosure,
  type CanonicalResumeDoc,
  type CitationSourceKind,
  type GapClassification,
  type ProfileContactLink,
  type ProjectProvenance,
  type RequirementCategory,
  type RequirementKind,
  type ResumeClaimSection,
  type ResumeComposeRunStatus,
  type ResumeGateViolation,
  type SkillLevel,
} from '@careerforge/core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { requirements } from '../schema/extractions.ts';
import { fitReports } from '../schema/fit.ts';
import { gaps } from '../schema/gaps.ts';
import {
  profileContact,
  profileEducation,
  profileExperienceBullets,
  profileExperiences,
  profileProjects,
  profileSkills,
  profileSummaries,
} from '../schema/profile.ts';
import {
  resumeClaimCitations,
  resumeClaims,
  resumeComposeRuns,
  resumeDocuments,
} from '../schema/resume-compose.ts';
import { type FitReportRow } from './fit-reports.repository.ts';

// M6-04 (ADR-0018): compose-service persistence + reads. The service reads
// verified profile evidence server-side (getComposeInputs - the REQUIRED-1
// never-trust-the-client anchor: every gate input except the claims is derived
// here from the DB), drafts via resume-compose@v1, gates with
// checkClaimProvenance, and on ok-with-claims persists the document + claims +
// citation ledger in ONE transaction (persistComposeOutcome, the
// persistTailoringOutcome precedent). Any gate violation flags the run and
// writes nothing. Profile FKs on claims/citations are SET NULL (navigation); the
// durable record is canonicalDoc + the citation sourceText snapshot.

export type ResumeComposeRunRow = typeof resumeComposeRuns.$inferSelect;
export type ResumeDocumentRow = typeof resumeDocuments.$inferSelect;
export type ResumeClaimRow = typeof resumeClaims.$inferSelect;
export type ResumeClaimCitationRow = typeof resumeClaimCitations.$inferSelect;

// ---- server-derived compose inputs (REQUIRED-1) ----
// Plain db-local shapes (the module wall: db never imports @careerforge/llm).
// The apps/api service maps these onto the builder's ComposeExperienceInput etc.

export interface ComposeInputExperience {
  experienceId: string;
  company: string;
  title: string;
  startDate: string;
  endDate: string | null;
  bullets: { bulletId: string; text: string }[];
}
export interface ComposeInputProject {
  projectId: string;
  name: string;
  provenance: ProjectProvenance;
  experienceId: string | null;
  description: string;
}
export interface ComposeInputSkill {
  skillId: string;
  name: string;
  level: SkillLevel;
}
export interface ComposeInputSummary {
  summaryId: string;
  text: string;
}
export interface ComposeInputEducation {
  institution: string;
  credential: string | null;
  startYear: number | null;
  endYear: number | null;
}
/** links is returned as the column $type; the SERVICE re-validates it with
 *  profileContactLinksSchema (obligation 1 - jsonb is unvalidated bytes). */
export interface ComposeInputContact {
  fullName: string;
  headline: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  links: ProfileContactLink[];
}
export interface ComposeInputGuidance {
  requirements: {
    requirementId: string;
    text: string;
    kind: RequirementKind;
    category: RequirementCategory;
  }[];
  gaps: { gapId: string; classification: GapClassification; requirementId: string }[];
}
export interface ComposeInputs {
  /** null when no profile_contact row exists (the service 409s profile-incomplete). */
  contact: ComposeInputContact | null;
  experiences: ComposeInputExperience[];
  projects: ComposeInputProject[];
  skills: ComposeInputSkill[];
  summaries: ComposeInputSummary[];
  education: ComposeInputEducation[];
  guidance: ComposeInputGuidance;
}

// ---- persist inserts (prepared by the service, written in one tx) ----

export interface ComposeRunInsert {
  promptId: string;
  provider: string;
  model: string;
  rawResponse: unknown;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  latencyMs: number;
  attempt: number;
  /** The run's stored status. For NON-final runs this is the wire status; for
   *  the FINAL run the SERVICE passes the status already resolved through the
   *  single policy site deriveComposeRunStatus (so it may be `flagged`/`empty`).
   *  The repository stores it verbatim - it does not re-derive (the policy
   *  decision, and its D6 tamper-proof neuter target, live at the one call site
   *  in the service, which also gates whether `document` is provided). */
  status: ResumeComposeRunStatus;
  /** M15-01 - the SAFE gate violations for this row, or NULL when the gate never
   *  ran for it. REQUIRED, not optional: an optional field would let a call site
   *  silently omit it, which reads as `undefined` - a fourth state the tri-state
   *  contract forbids. Requiredness makes the compiler enumerate every insert
   *  site instead of leaving it to a grep. The discriminant is "did the gate
   *  run", NEVER the status: `seed.ts`'s synthetic `ok` row is NULL. */
  gateViolations: ResumeGateViolation[] | null;
  createdAt: Date;
}

export interface ComposeCitationInsert {
  sourceKind: CitationSourceKind;
  sourceText: string;
  experienceBulletId: string | null;
  masteryEvidenceId: string | null;
  projectId: string | null;
  summaryId: string | null;
}

export interface ComposeClaimInsert {
  section: ResumeClaimSection;
  experienceId: string | null;
  projectId: string | null;
  text: string;
  /** Cited sources in claim order; position assigned from array order. */
  citations: ComposeCitationInsert[];
}

export interface ComposeDocumentInsert {
  canonicalDoc: CanonicalResumeDoc;
  /** Claims in output order; position assigned from array order. */
  claims: ComposeClaimInsert[];
  /** M15-03 - present ONLY for a `degraded` run, naming which aggregate caps
   *  fired and how many claims went from which section. Absent (stored NULL)
   *  for every ok run: this document is the model's draft entire. */
  degradeDisclosure?: AggregateTrimDisclosure;
}

export interface ComposePersistOutcome {
  runs: ResumeComposeRunRow[];
  /** The document row iff THIS persist created one (ok, non-empty, no race loss). */
  document: ResumeDocumentRow | undefined;
  /** true iff the current-document unique fired (a concurrent compose won). */
  conflicted: boolean;
}

// ---- read joins ----

export interface ClaimWithCitations {
  claim: ResumeClaimRow;
  /** (position, id) order. */
  citations: ResumeClaimCitationRow[];
}
export interface DocumentWithClaims {
  document: ResumeDocumentRow;
  /** (position, id) order. */
  claims: ClaimWithCitations[];
  /** DERIVED at read: any compose-input row postdates this document (a warning,
   *  not a lock). Blind to deletions (ADVISORY-C). */
  stale: boolean;
}

/** M6-06 ats-coverage input row: the report's extraction-run requirement,
 *  tri-state `quoteVerified` carried (the scorer never filters). */
export interface AtsRequirementRow {
  requirementId: string;
  text: string;
  kind: RequirementKind;
  category: RequirementCategory;
  quoteVerified: boolean | null;
}

export type DocumentReviewOutcome =
  | { kind: 'reviewed'; document: ResumeDocumentRow }
  | { kind: 'already_reviewed' }
  | { kind: 'superseded' }
  | { kind: 'not_found' };

export type SupersedeOutcome =
  | { kind: 'superseded'; document: ResumeDocumentRow }
  | { kind: 'not_current' }
  | { kind: 'not_found' };

/**
 * The SINGLE POLICY SITE (the deriveResumeRunStatus precedent, extended). An ok
 * wire call whose claims fail the claim-provenance gate becomes `flagged`; an ok
 * call with zero claims becomes `empty`; every other case passes through. The
 * SERVICE calls this ONCE to resolve the final run's status AND uses the result
 * to decide whether to persist a document. Neutering it is the D6 route-level
 * tamper-proof planted-FAIL: forcing it to return the wire status makes the
 * service persist a fabricated/mis-provenanced or empty draft, and the tamper
 * tests go red. Pure - no DB, so it is unit-testable in isolation.
 *
 * M15-03 adds the THIRD policy status. `degrade` carries the two facts the
 * caller must establish BEFORE calling (both derived in packages/core, which
 * owns the trim - this site decides policy, it does not trim):
 * - `aggregateOnly`: the violation set is aggregate-cap breaches and NOTHING
 *   else (isAggregateOnlyViolationSet). Condition 1 - degrade is a trim of an
 *   otherwise-clean draft, NEVER a repair path, so ANY truthfulness or
 *   per-claim violation still flags wholesale.
 * - `remainderEmpty`: the trim removed every claim. The existing empty-draft
 *   policy WINS over degrade (an empty resume is not a persisted artifact).
 *
 * The parameter is REQUIRED, not optional-with-a-default, and deliberately so:
 * a default would let an existing call site keep pre-M15-03 behaviour silently.
 * The type is what forces every caller to confront the policy.
 *
 * PERSISTENCE CONTRACT, changed by this story: `ok` is NO LONGER the only
 * status that persists. `ok` and `degraded` both carry a document; `flagged`
 * and `empty` carry none. Callers must not test `status === 'ok'` to mean
 * "something was written".
 */
export function deriveComposeRunStatus(
  status: Exclude<ResumeComposeRunStatus, 'flagged' | 'empty' | 'degraded'>,
  gateViolated: boolean,
  isEmpty: boolean,
  degrade: { aggregateOnly: boolean; remainderEmpty: boolean },
): ResumeComposeRunStatus {
  if (status !== 'ok') return status;
  if (gateViolated) {
    if (!degrade.aggregateOnly) return 'flagged';
    return degrade.remainderEmpty ? 'empty' : 'degraded';
  }
  if (isEmpty) return 'empty';
  return 'ok';
}

export interface ResumeDocumentsRepository {
  findReportById(userId: string, reportId: string): Promise<FitReportRow | undefined>;
  /** REQUIRED-1: the full server-derived compose input set for a report. */
  getComposeInputs(userId: string, fitReportId: string): Promise<ComposeInputs>;
  /**
   * ONE transaction. Always inserts the wire-call audit rows; the final run's
   * stored status passes through deriveComposeRunStatus. Inserts the document +
   * claims + citations ONLY when `document` is provided (the caller's contract:
   * provided iff the final run is ok, the gate passed, and there is >=1 claim).
   * `revision` is computed as MAX(revision)+1 for the report inside the tx. The
   * document insert is ON CONFLICT DO NOTHING on (fit_report_id, revision): a
   * concurrent compose that already created the current revision leaves this one
   * a no-op and the outcome `conflicted` (the caller returns the winner cached).
   */
  persistComposeOutcome(
    userId: string,
    fitReportId: string,
    runs: ComposeRunInsert[],
    document: ComposeDocumentInsert | undefined,
  ): Promise<ComposePersistOutcome>;
  /** The report's CURRENT (non-superseded) document + claims + citations + the
   *  derived stale flag, or undefined when none. */
  findCurrentDocument(userId: string, fitReportId: string): Promise<DocumentWithClaims | undefined>;
  /** Read a document by id + claims + citations + stale (redraft/review anchor). */
  findDocumentById(userId: string, documentId: string): Promise<DocumentWithClaims | undefined>;
  /** LEAN by-id read for M6-05 export/audit: the row only (canonicalDoc +
   *  reviewStatus + supersededAt), userId-scoped - export renders from the durable
   *  snapshot and needs no claims/stale join. undefined when absent or not owned. */
  getDocumentById(userId: string, documentId: string): Promise<ResumeDocumentRow | undefined>;
  /** M6-06: the report's extraction-run requirements for ATS coverage - the
   *  interview-preps findRequirementsForReport shape MINUS the gaps join (coverage
   *  needs no gap data). (position, id) order, user-scoped, tri-state carried. */
  findRequirementsForDocumentReport(
    userId: string,
    fitReportId: string,
  ): Promise<AtsRequirementRow[]>;
  /** Redraft CAS: supersede the current document (guarded superseded_at IS NULL). */
  supersedeDocument(userId: string, documentId: string): Promise<SupersedeOutcome>;
  /** One-shot review CAS: draft->reviewed, guarded on draft AND not superseded. */
  markDocumentReviewed(
    userId: string,
    documentId: string,
    notes: string | null,
  ): Promise<DocumentReviewOutcome>;
}

export function createResumeDocumentsRepository(db: Db): ResumeDocumentsRepository {
  async function loadClaims(documentId: string): Promise<ClaimWithCitations[]> {
    const claimRows = await db
      .select()
      .from(resumeClaims)
      .where(eq(resumeClaims.resumeDocumentId, documentId))
      .orderBy(asc(resumeClaims.position), asc(resumeClaims.id));
    if (claimRows.length === 0) return [];

    const claimIds = claimRows.map((row) => row.id);
    const citationRows = await db
      .select()
      .from(resumeClaimCitations)
      .where(inArray(resumeClaimCitations.resumeClaimId, claimIds))
      .orderBy(asc(resumeClaimCitations.position), asc(resumeClaimCitations.id));

    const byClaim = new Map<string, ResumeClaimCitationRow[]>();
    for (const row of citationRows) {
      const list = byClaim.get(row.resumeClaimId) ?? [];
      list.push(row);
      byClaim.set(row.resumeClaimId, list);
    }
    return claimRows.map((claim) => ({ claim, citations: byClaim.get(claim.id) ?? [] }));
  }

  /** DERIVED stale (D8): does ANY compose-input row for this user (or the
   *  report's gaps) postdate the document? One query, greatest() over per-table
   *  MAX(updated_at). Blind to deletions (ADVISORY-C). */
  async function isStale(userId: string, fitReportId: string, createdAt: Date): Promise<boolean> {
    const result = await db.execute<{ stale: boolean }>(sql`
      select greatest(
        coalesce((select max(updated_at) from profile_experiences where user_id = ${userId}), 'epoch'),
        coalesce((select max(updated_at) from profile_experience_bullets where user_id = ${userId}), 'epoch'),
        coalesce((select max(updated_at) from profile_projects where user_id = ${userId}), 'epoch'),
        coalesce((select max(updated_at) from profile_skills where user_id = ${userId}), 'epoch'),
        coalesce((select max(updated_at) from profile_summaries where user_id = ${userId}), 'epoch'),
        coalesce((select max(updated_at) from profile_education where user_id = ${userId}), 'epoch'),
        coalesce((select max(updated_at) from profile_contact where user_id = ${userId}), 'epoch'),
        coalesce((select max(updated_at) from gaps where fit_report_id = ${fitReportId}), 'epoch')
      ) > ${createdAt} as stale
    `);
    return result.rows[0]?.stale ?? false;
  }

  async function assembleDocument(
    userId: string,
    document: ResumeDocumentRow,
  ): Promise<DocumentWithClaims> {
    const claims = await loadClaims(document.id);
    const stale = await isStale(userId, document.fitReportId, document.createdAt);
    return { document, claims, stale };
  }

  return {
    async findReportById(userId, reportId) {
      const [report] = await db
        .select()
        .from(fitReports)
        .where(and(eq(fitReports.userId, userId), eq(fitReports.id, reportId)))
        .limit(1);
      return report;
    },

    async getComposeInputs(userId, fitReportId) {
      const [contactRow] = await db
        .select()
        .from(profileContact)
        .where(eq(profileContact.userId, userId))
        .limit(1);

      const experienceRows = await db
        .select()
        .from(profileExperiences)
        .where(eq(profileExperiences.userId, userId))
        .orderBy(asc(profileExperiences.startDate), asc(profileExperiences.id));
      const experienceIds = experienceRows.map((row) => row.id);
      const bulletRows =
        experienceIds.length === 0
          ? []
          : await db
              .select()
              .from(profileExperienceBullets)
              .where(inArray(profileExperienceBullets.experienceId, experienceIds))
              .orderBy(asc(profileExperienceBullets.position), asc(profileExperienceBullets.id));
      const bulletsByExperience = new Map<string, { bulletId: string; text: string }[]>();
      for (const bullet of bulletRows) {
        const list = bulletsByExperience.get(bullet.experienceId) ?? [];
        list.push({ bulletId: bullet.id, text: bullet.text });
        bulletsByExperience.set(bullet.experienceId, list);
      }

      const projectRows = await db
        .select()
        .from(profileProjects)
        .where(eq(profileProjects.userId, userId))
        .orderBy(asc(profileProjects.name), asc(profileProjects.id));

      const skillRows = await db
        .select()
        .from(profileSkills)
        .where(eq(profileSkills.userId, userId))
        .orderBy(asc(profileSkills.name), asc(profileSkills.id));

      const summaryRows = await db
        .select()
        .from(profileSummaries)
        .where(eq(profileSummaries.userId, userId))
        .orderBy(asc(profileSummaries.position), asc(profileSummaries.id));

      const educationRows = await db
        .select()
        .from(profileEducation)
        .where(eq(profileEducation.userId, userId))
        .orderBy(asc(profileEducation.position), asc(profileEducation.id));

      // Guidance = the report's gaps + the requirements they reference.
      const gapRows = await db
        .select({
          gapId: gaps.id,
          classification: gaps.classification,
          requirementId: gaps.requirementId,
          requirementText: requirements.text,
          requirementKind: requirements.kind,
          requirementCategory: requirements.category,
        })
        .from(gaps)
        .innerJoin(requirements, eq(requirements.id, gaps.requirementId))
        .where(and(eq(gaps.userId, userId), eq(gaps.fitReportId, fitReportId)))
        .orderBy(asc(gaps.id));

      const requirementSeen = new Set<string>();
      const guidanceRequirements: ComposeInputGuidance['requirements'] = [];
      const guidanceGaps: ComposeInputGuidance['gaps'] = [];
      for (const gap of gapRows) {
        if (!requirementSeen.has(gap.requirementId)) {
          requirementSeen.add(gap.requirementId);
          guidanceRequirements.push({
            requirementId: gap.requirementId,
            text: gap.requirementText,
            kind: gap.requirementKind,
            category: gap.requirementCategory,
          });
        }
        guidanceGaps.push({
          gapId: gap.gapId,
          classification: gap.classification,
          requirementId: gap.requirementId,
        });
      }

      return {
        contact: contactRow
          ? {
              fullName: contactRow.fullName,
              headline: contactRow.headline,
              email: contactRow.email,
              phone: contactRow.phone,
              location: contactRow.location,
              links: contactRow.links,
            }
          : null,
        experiences: experienceRows.map((row) => ({
          experienceId: row.id,
          company: row.company,
          title: row.title,
          startDate: row.startDate,
          endDate: row.endDate,
          bullets: bulletsByExperience.get(row.id) ?? [],
        })),
        // Only projects with a non-empty description carry citable prose.
        projects: projectRows
          .filter((row) => row.summary !== null && row.summary.trim() !== '')
          .map((row) => ({
            projectId: row.id,
            name: row.name,
            provenance: row.provenance,
            experienceId: row.experienceId,
            description: row.summary ?? '',
          })),
        skills: skillRows.map((row) => ({ skillId: row.id, name: row.name, level: row.level })),
        summaries: summaryRows.map((row) => ({ summaryId: row.id, text: row.text })),
        education: educationRows.map((row) => ({
          institution: row.institution,
          credential: row.credential,
          startYear: row.startYear,
          endYear: row.endYear,
        })),
        guidance: { requirements: guidanceRequirements, gaps: guidanceGaps },
      };
    },

    async persistComposeOutcome(userId, fitReportId, runs, document) {
      if (runs.length === 0) throw new Error('persistComposeOutcome requires at least one run');
      const finalIndex = runs.length - 1;

      return db.transaction(async (tx) => {
        const runRows: ResumeComposeRunRow[] = [];
        for (const run of runs) {
          // Stored verbatim: the final run's status was already resolved through
          // deriveComposeRunStatus at the service's single policy site (which
          // also gated whether `document` is provided). The repo does not
          // re-derive - it faithfully writes what the one policy decision chose.
          const [runRow] = await tx
            .insert(resumeComposeRuns)
            .values({
              userId,
              fitReportId,
              promptId: run.promptId,
              provider: run.provider,
              model: run.model,
              rawResponse: run.rawResponse,
              inputTokens: run.inputTokens,
              outputTokens: run.outputTokens,
              cacheReadInputTokens: run.cacheReadInputTokens,
              cacheCreationInputTokens: run.cacheCreationInputTokens,
              latencyMs: run.latencyMs,
              attempt: run.attempt,
              status: run.status,
              gateViolations: run.gateViolations,
              createdAt: run.createdAt,
            })
            .returning();
          if (!runRow) throw new Error('resume_compose_runs insert returned no rows');
          runRows.push(runRow);
        }

        const finalRun = runRows[finalIndex];
        if (!finalRun) throw new Error('unreachable: runs is non-empty');

        if (document === undefined) {
          return { runs: runRows, document: undefined, conflicted: false };
        }
        // M15-03: `ok` is NO LONGER the only persisting status - `degraded`
        // carries the lawful remainder of an aggregate-cap trim. Deliberately an
        // explicit allow-list of the two persisting statuses rather than a
        // deny-list of `flagged`/`empty`: this guard is the backstop against a
        // caller handing a document to a status that must write nothing, so a
        // future status must FAIL CLOSED here rather than be admitted by default.
        if (finalRun.status !== 'ok' && finalRun.status !== 'degraded') {
          throw new Error('a resume document requires an ok or degraded final run');
        }

        // revision = MAX(revision)+1 for the report (1 for the first).
        const revisionResult = await tx.execute<{ nextRevision: number }>(sql`
          select coalesce(max(revision), 0) + 1 as "nextRevision"
          from resume_documents where fit_report_id = ${fitReportId}
        `);
        const nextRevision = revisionResult.rows[0]?.nextRevision;
        if (nextRevision === undefined) throw new Error('revision computation returned no row');
        const [documentRow] = await tx
          .insert(resumeDocuments)
          .values({
            userId,
            fitReportId,
            composeRunId: finalRun.id,
            revision: nextRevision,
            canonicalDoc: document.canonicalDoc,
            // `?? null` rather than passing undefined: an absent key would let
            // drizzle omit the column, and the intent here is an explicit
            // "nothing was trimmed", written down.
            degradeDisclosure: document.degradeDisclosure ?? null,
          })
          // No arbiter: DO NOTHING on ANY unique conflict, so BOTH concurrent-race
          // interleavings are swallowed (REQUIRED-2) - the same-revision collision
          // on (fit_report_id, revision) AND the TOCTOU leg where this compose
          // computed rev N+1 while a concurrent one already made rev N current
          // (a second current row -> the partial resume_documents_current_unique).
          // The only uniques on this table are those two + the uuid PK, so an
          // untargeted DO NOTHING can swallow nothing else.
          .onConflictDoNothing()
          .returning();
        if (!documentRow) {
          // A concurrent compose already created the current document - the runs
          // are committed (both wire calls happened) and the caller re-reads the
          // winner (REQUIRED-2 race recovery).
          return { runs: runRows, document: undefined, conflicted: true };
        }

        for (const [claimIndex, claim] of document.claims.entries()) {
          const [claimRow] = await tx
            .insert(resumeClaims)
            .values({
              userId,
              resumeDocumentId: documentRow.id,
              section: claim.section,
              experienceId: claim.experienceId,
              projectId: claim.projectId,
              text: claim.text,
              position: claimIndex,
            })
            .returning();
          if (!claimRow) throw new Error('resume_claims insert returned no rows');
          if (claim.citations.length > 0) {
            await tx.insert(resumeClaimCitations).values(
              claim.citations.map((citation, position) => ({
                userId,
                resumeClaimId: claimRow.id,
                sourceKind: citation.sourceKind,
                sourceText: citation.sourceText,
                experienceBulletId: citation.experienceBulletId,
                masteryEvidenceId: citation.masteryEvidenceId,
                projectId: citation.projectId,
                summaryId: citation.summaryId,
                position,
              })),
            );
          }
        }

        return { runs: runRows, document: documentRow, conflicted: false };
      });
    },

    async findCurrentDocument(userId, fitReportId) {
      const [documentRow] = await db
        .select()
        .from(resumeDocuments)
        .where(
          and(
            eq(resumeDocuments.userId, userId),
            eq(resumeDocuments.fitReportId, fitReportId),
            sql`${resumeDocuments.supersededAt} is null`,
          ),
        )
        .limit(1);
      if (!documentRow) return undefined;
      return assembleDocument(userId, documentRow);
    },

    async findDocumentById(userId, documentId) {
      const [documentRow] = await db
        .select()
        .from(resumeDocuments)
        .where(and(eq(resumeDocuments.userId, userId), eq(resumeDocuments.id, documentId)))
        .limit(1);
      if (!documentRow) return undefined;
      return assembleDocument(userId, documentRow);
    },

    async getDocumentById(userId, documentId) {
      const [documentRow] = await db
        .select()
        .from(resumeDocuments)
        .where(and(eq(resumeDocuments.userId, userId), eq(resumeDocuments.id, documentId)))
        .limit(1);
      return documentRow;
    },

    async findRequirementsForDocumentReport(userId, fitReportId) {
      return db
        .select({
          requirementId: requirements.id,
          text: requirements.text,
          kind: requirements.kind,
          category: requirements.category,
          quoteVerified: requirements.quoteVerified,
        })
        .from(requirements)
        .innerJoin(fitReports, eq(fitReports.extractionRunId, requirements.extractionRunId))
        .where(and(eq(requirements.userId, userId), eq(fitReports.id, fitReportId)))
        .orderBy(asc(requirements.position), asc(requirements.id));
    },

    async supersedeDocument(userId, documentId) {
      const [updated] = await db
        .update(resumeDocuments)
        .set({ supersededAt: sql`now()` })
        .where(
          and(
            eq(resumeDocuments.userId, userId),
            eq(resumeDocuments.id, documentId),
            sql`${resumeDocuments.supersededAt} is null`,
          ),
        )
        .returning();
      if (updated) return { kind: 'superseded', document: updated };

      const [existing] = await db
        .select({ id: resumeDocuments.id })
        .from(resumeDocuments)
        .where(and(eq(resumeDocuments.userId, userId), eq(resumeDocuments.id, documentId)))
        .limit(1);
      return existing ? { kind: 'not_current' } : { kind: 'not_found' };
    },

    async markDocumentReviewed(userId, documentId, notes) {
      const [updated] = await db
        .update(resumeDocuments)
        .set({ reviewStatus: 'reviewed', notes })
        .where(
          and(
            eq(resumeDocuments.userId, userId),
            eq(resumeDocuments.id, documentId),
            eq(resumeDocuments.reviewStatus, 'draft'),
            sql`${resumeDocuments.supersededAt} is null`,
          ),
        )
        .returning();
      if (updated) return { kind: 'reviewed', document: updated };

      const [existing] = await db
        .select({
          reviewStatus: resumeDocuments.reviewStatus,
          supersededAt: resumeDocuments.supersededAt,
        })
        .from(resumeDocuments)
        .where(and(eq(resumeDocuments.userId, userId), eq(resumeDocuments.id, documentId)))
        .limit(1);
      if (!existing) return { kind: 'not_found' };
      if (existing.supersededAt !== null) return { kind: 'superseded' };
      return { kind: 'already_reviewed' };
    },
  };
}
