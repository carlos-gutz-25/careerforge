import {
  EVIDENCE_STRENGTHS,
  FIT_DIMENSIONS,
  FIT_REVIEW_STATUSES,
  FIT_VERDICTS,
  type ExclusionVerdict,
  type ForcedLowest,
  type SearchCriteriaData,
} from '@careerforge/core';
import { sql } from 'drizzle-orm';
import { boolean, check, jsonb, pgTable, real, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './auth.ts';
import { extractionRuns, requirements } from './extractions.ts';
import { enumCheck, id, timestamps } from './helpers.ts';
import { jobPostings } from './jobs.ts';
import { profileExperiences, profileProjects, profileSkills } from './profile.ts';

// M1-09: the deterministic fit engine's artifact tables (amended ERD,
// ARCHITECTURE §3). APPEND-ONLY like extraction_runs: re-scoring inserts a
// new report, never mutates — M1-11 overrides key on requirement_id, which
// survives re-scoring (not re-extraction; cross-run override identity is
// M1-11 design space). The jsonb payloads carry the canonical core fit/
// criteria shapes ($types below): engine output, DB, and the future M1-10
// wire report share ONE set of zod contracts and can never disagree.

export const fitReports = pgTable(
  'fit_reports',
  {
    id: id(),
    // ADR-0007: every table carries user_id (extraction_runs precedent).
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // CASCADE: report payloads embed posting quotes, so a posting deletion
    // must not leave them behind (privacy-coherent, extraction_runs
    // precedent).
    postingId: uuid()
      .notNull()
      .references(() => jobPostings.id, { onDelete: 'cascade' }),
    // The requirement-bearing run this report scored; its requirements are
    // the report's posting-side inputs. CASCADE with its run.
    extractionRunId: uuid()
      .notNull()
      .references(() => extractionRuns.id, { onDelete: 'cascade' }),
    // ERD amendment (M1-09): the explicit exclusion verdict is representable
    // at rest — never a silent low score (M1-08 domain law).
    verdict: text({ enum: FIT_VERDICTS }).notNull(),
    // Fired hard filters with their quote evidence; [] iff verdict='scored'
    // (the zod'd write path enforces the mirror — engine output is parsed
    // through fitReportDataSchema before it gets here).
    exclusions: jsonb().$type<ExclusionVerdict[]>().notNull(),
    // A1: the EXACT criteria object passed to scoreFit — criteria is the one
    // mutable, un-copied input, and reports must stay self-explaining after
    // criteria edits (raw_response snapshot precedent).
    criteriaSnapshot: jsonb().$type<SearchCriteriaData>().notNull(),
    // A2/D8: the force-lowest OUTCOME at scoring time (flag, never a score
    // clamp) — not re-derivable after criteria mutate. One jsonb, not two
    // columns: matchedSlugs is a list and the exclusions pattern fits.
    forcedLowest: jsonb().$type<ForcedLowest>().notNull(),
    // The scored run was 'flagged' (M1-06): input was degraded — the M1-10
    // UI renders this prominently.
    inputFlagged: boolean().notNull(),
    // Draft-until-reviewed, like every generated artifact.
    reviewStatus: text({ enum: FIT_REVIEW_STATUSES }).notNull().default('draft'),
    notes: text(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('fit_reports_verdict_check', table.verdict, FIT_VERDICTS),
    enumCheck('fit_reports_review_status_check', table.reviewStatus, FIT_REVIEW_STATUSES),
  ],
);

export const fitSubScores = pgTable(
  'fit_sub_scores',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Sub-scores are derived artifacts of their report — they go with it.
    fitReportId: uuid()
      .notNull()
      .references(() => fitReports.id, { onDelete: 'cascade' }),
    dimension: text({ enum: FIT_DIMENSIONS }).notNull(),
    score: real().notNull(),
    // Deterministic, rule-generated (never LLM); states its own inputs
    // (seniority always cites the reference date).
    rationale: text().notNull(),
    ...timestamps(),
  },
  (table) => [
    enumCheck('fit_sub_scores_dimension_check', table.dimension, FIT_DIMENSIONS),
    check('fit_sub_scores_score_range_check', sql`${table.score} >= 0 and ${table.score} <= 1`),
    // One row per dimension per report (the contract's exactly-once law,
    // pinned at the DB too).
    uniqueIndex('fit_sub_scores_report_dimension_unique').on(table.fitReportId, table.dimension),
  ],
);

export const evidenceLinks = pgTable(
  'evidence_links',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // ERD amendment (M1-09): anchored to the SUB-SCORE (the ERD hung
    // evidence off requirements alone; without a report-side anchor,
    // re-scoring would mingle evidence across reports).
    fitSubScoreId: uuid()
      .notNull()
      .references(() => fitSubScores.id, { onDelete: 'cascade' }),
    requirementId: uuid()
      .notNull()
      .references(() => requirements.id, { onDelete: 'cascade' }),
    // Profile pointers are navigation; the QUOTES are the durable evidence.
    // SET NULL: profile rows may be re-imported or deleted (M0-08 full-sync)
    // — evidence text survives as text. profile_experience_id is D9 (the
    // fourth ERD amendment): adjacent evidence can be experience-derived.
    profileSkillId: uuid().references(() => profileSkills.id, { onDelete: 'set null' }),
    profileProjectId: uuid().references(() => profileProjects.id, { onDelete: 'set null' }),
    profileExperienceId: uuid().references(() => profileExperiences.id, { onDelete: 'set null' }),
    // Posting-derived: UNTRUSTED on display, like raw_text (RISKS S-02).
    postingQuote: text().notNull(),
    profileQuote: text().notNull(),
    strength: text({ enum: EVIDENCE_STRENGTHS }).notNull(),
    ...timestamps(),
  },
  (table) => [enumCheck('evidence_links_strength_check', table.strength, EVIDENCE_STRENGTHS)],
);
