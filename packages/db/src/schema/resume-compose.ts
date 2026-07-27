import {
  CITATION_SOURCE_KINDS,
  RESUME_CLAIM_SECTIONS,
  RESUME_COMPOSE_RUN_STATUSES,
  RESUME_DOCUMENT_REVIEW_STATUSES,
  type CanonicalResumeDoc,
} from '@careerforge/core';
import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { fitReports } from './fit.ts';
import { enumCheck, id, timestamps } from './helpers.ts';
import { masteryEvidence } from './mastery.ts';
import {
  profileExperienceBullets,
  profileExperiences,
  profileProjects,
  profileSummaries,
} from './profile.ts';

// M6-04 (ADR-0018): Resume Studio's COMPOSED-with-provenance artifact - the
// PRIMARY, distinct from the M2-10 resume_variants tailoring GUIDE (secondary;
// the UI must never present one as the other). The compose service reads
// verified profile evidence server-side, drafts claims via resume-compose@v1,
// gates them with checkClaimProvenance (packages/scoring - M6-04 is its first
// and only caller), and on ok-with-claims persists the document + claims +
// citation ledger in ONE transaction; ANY gate violation flags the run and
// writes NOTHING (the house tripwire).
//
// FK durability principle (the resume_variants law, resume.ts:128-134): the
// OWNERSHIP spine (user / fit_report / compose_run / document / claim) is ON
// DELETE CASCADE; every FK into a MUTABLE PROFILE row is ON DELETE SET NULL,
// because the M0-08 full-sync may re-import or delete profile rows and a
// re-import must NOT mutate a possibly-reviewed artifact. The durable display is
// the canonicalDoc snapshot + the citation sourceText snapshot + the
// position-ordered surviving rows; the live FKs are navigation. That forces the
// two child CHECKs into SET-NULL-tolerant forms (implication + at-most-one).

/** Audit: one row per WIRE call (the resume_variant_runs law at a fourth call
 *  site). raw_response is UNTRUSTED + PRIVATE (embeds profile text): never
 *  logged, never on the wire. status holds the runner's wire status, overridden
 *  post-hoc at the single persist-policy site to the policy statuses `flagged`
 *  (gate violation) or `empty` (zero-claim ok draft) - never by the runner. */
export const resumeComposeRuns = pgTable(
  'resume_compose_runs',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fitReportId: uuid()
      .notNull()
      .references(() => fitReports.id, { onDelete: 'cascade' }),
    provider: text().notNull(),
    model: text().notNull(),
    promptId: text().notNull(),
    rawResponse: jsonb().notNull(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    cacheReadInputTokens: integer().notNull(),
    cacheCreationInputTokens: integer().notNull(),
    latencyMs: integer().notNull(),
    attempt: integer().notNull(),
    status: text({ enum: RESUME_COMPOSE_RUN_STATUSES }).notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('resume_compose_runs_status_check', table.status, RESUME_COMPOSE_RUN_STATUSES),
  ],
);

/** The pinned PRIMARY artifact. Pin-to-report = fit_report_id; revisions
 *  accumulate (redraft supersedes + drafts N+1). The partial unique on
 *  (fit_report_id) WHERE superseded_at IS NULL = "at most one CURRENT document
 *  per report" (the M3-06 partial-unique-active precedent) and is the compose
 *  cache. canonical_doc is the deterministic+composed snapshot M6-05 renders. */
export const resumeDocuments = pgTable(
  'resume_documents',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fitReportId: uuid()
      .notNull()
      .references(() => fitReports.id, { onDelete: 'cascade' }),
    // Audit anchor: the ok, gate-passing wire call this document was parsed from.
    composeRunId: uuid()
      .notNull()
      .references(() => resumeComposeRuns.id, { onDelete: 'cascade' }),
    revision: integer().notNull(),
    canonicalDoc: jsonb().$type<CanonicalResumeDoc>().notNull(),
    reviewStatus: text({ enum: RESUME_DOCUMENT_REVIEW_STATUSES }).notNull().default('draft'),
    // NULL = the current revision; non-null = superseded by a later redraft.
    supersededAt: timestamp({ withTimezone: true }),
    notes: text(),
    ...timestamps(),
  },
  (table) => [
    enumCheck(
      'resume_documents_review_status_check',
      table.reviewStatus,
      RESUME_DOCUMENT_REVIEW_STATUSES,
    ),
    // Revisions never overwrite: (report, revision) is unique.
    uniqueIndex('resume_documents_report_revision_unique').on(table.fitReportId, table.revision),
    // At most one CURRENT document per report (the cache key; the redraft
    // supersede-CAS is the serializer that keeps this from firing mid-race).
    uniqueIndex('resume_documents_current_unique')
      .on(table.fitReportId)
      .where(sql`${table.supersededAt} is null`),
  ],
);

/** One composed claim (child of a document). The entity FK is server-resolved
 *  from the model's entityRef (x{n}/p{n}) and is NAVIGATION (SET NULL on profile
 *  re-import) - the durable entity display is canonicalDoc's entityLabel. The
 *  section<->entity CHECK is IMPLICATION form (the resume_variant_entries
 *  precedent) so a SET-NULL tombstone never violates it. */
export const resumeClaims = pgTable(
  'resume_claims',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resumeDocumentId: uuid()
      .notNull()
      .references(() => resumeDocuments.id, { onDelete: 'cascade' }),
    section: text({ enum: RESUME_CLAIM_SECTIONS }).notNull(),
    experienceId: uuid().references(() => profileExperiences.id, { onDelete: 'set null' }),
    projectId: uuid().references(() => profileProjects.id, { onDelete: 'set null' }),
    text: text().notNull(),
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('resume_claims_section_check', table.section, RESUME_CLAIM_SECTIONS),
    // Implication form (non-matching FKs pinned NULL; the matching one MAY still
    // be NULL after a SET-NULL re-import). experience_id non-null only when
    // section='experience'; project_id non-null only when section='project'; a
    // summary claim carries neither.
    check(
      'resume_claims_section_entity_check',
      sql`(${table.section} <> 'experience' or ${table.projectId} is null)
        and (${table.section} <> 'project' or ${table.experienceId} is null)
        and (${table.section} <> 'summary' or (${table.experienceId} is null and ${table.projectId} is null))`,
    ),
    uniqueIndex('resume_claims_document_position_unique').on(
      table.resumeDocumentId,
      table.position,
    ),
  ],
);

/** The provenance ledger (grandchild). source_kind is the DURABLE class and
 *  source_text the DURABLE snapshot of the cited evidence (the user's own
 *  verified prose); the four profile FKs are NAVIGATION (SET NULL on re-import).
 *  The CHECK is AT-MOST-ONE-non-null (NOT exactly-one) so a SET-NULL tombstone
 *  leaves the row valid with all four FKs null; INSERT-time exactly-one is a
 *  service invariant (pinned by test). Row count per claim is preserved across
 *  profile deletion, so a persisted claim never silently loses its citation. */
export const resumeClaimCitations = pgTable(
  'resume_claim_citations',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    resumeClaimId: uuid()
      .notNull()
      .references(() => resumeClaims.id, { onDelete: 'cascade' }),
    sourceKind: text({ enum: CITATION_SOURCE_KINDS }).notNull(),
    sourceText: text().notNull(),
    experienceBulletId: uuid().references(() => profileExperienceBullets.id, {
      onDelete: 'set null',
    }),
    masteryEvidenceId: uuid().references(() => masteryEvidence.id, { onDelete: 'set null' }),
    projectId: uuid().references(() => profileProjects.id, { onDelete: 'set null' }),
    summaryId: uuid().references(() => profileSummaries.id, { onDelete: 'set null' }),
    position: integer().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('resume_claim_citations_source_kind_check', table.sourceKind, CITATION_SOURCE_KINDS),
    // At most one live profile FK (survives a SET-NULL tombstone with all null).
    check(
      'resume_claim_citations_source_atmost1_check',
      sql`(case when ${table.experienceBulletId} is not null then 1 else 0 end
        + case when ${table.masteryEvidenceId} is not null then 1 else 0 end
        + case when ${table.projectId} is not null then 1 else 0 end
        + case when ${table.summaryId} is not null then 1 else 0 end) <= 1`,
    ),
    uniqueIndex('resume_claim_citations_claim_position_unique').on(
      table.resumeClaimId,
      table.position,
    ),
  ],
);
