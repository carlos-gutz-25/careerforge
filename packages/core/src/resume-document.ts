import { z } from 'zod';

import {
  citationSourceKindSchema,
  resumeComposeRunStatusSchema,
  resumeDocumentReviewStatusSchema,
  skillLevelSchema,
} from './enums.ts';
import { profileContactLinksSchema } from './profile.ts';
import { resumeClaimSectionSchema } from './resume-compose.ts';

// Wire contracts for the M6-04 Resume Studio COMPOSED artifact (ADR-0018) - the
// PRIMARY, distinct from the M2-10 resume_variants tailoring GUIDE (ADR-0012,
// secondary; the UI must never present one as the other). Routes:
//   POST /fit-reports/:id/resume-document   (cache-or-compose; 200 cached / 201 new)
//   GET  /fit-reports/:id/resume-document   (current revision + stale flag)
//   POST /resume-documents/:id/redraft      (supersede current + draft N+1)
//   POST /resume-documents/:id/review       (one-shot draft->reviewed CAS)
// Two values NEVER cross the wire: raw_response (audit/replay; embeds profile
// text) and user_id. The composed document contains NO posting-derived strings
// (the untrusted-text rendering-side law; requirements/gaps GUIDE selection but
// never enter the document). Claim text is the user's own composed-from-evidence
// prose; UNTRUSTED on display (escaped in the UI) as the house rule.

// ---- canonical document snapshot (stored jsonb; M6-05 renders FROM it) ----
// Assembled ONCE at persist so the document stays self-explaining after profile
// edits (the fit_reports.criteriaSnapshot precedent). Contact / education /
// skills are DETERMINISTIC verified facts (V2-PLAN 3.1 "what stays
// deterministic"); claims are the gated composed prose with their entity resolved
// to a durable display label (the resume_variant_entries label/detail snapshot
// precedent - the live FK is navigation, this label is durable).

export const canonicalContactSchema = z.strictObject({
  fullName: z.string(),
  headline: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  links: profileContactLinksSchema,
});
export type CanonicalContact = z.infer<typeof canonicalContactSchema>;

export const canonicalEducationSchema = z.strictObject({
  institution: z.string(),
  credential: z.string().nullable(),
  startYear: z.number().int().nullable(),
  endYear: z.number().int().nullable(),
});
export type CanonicalEducation = z.infer<typeof canonicalEducationSchema>;

export const canonicalSkillSchema = z.strictObject({
  name: z.string(),
  level: skillLevelSchema,
});
export type CanonicalSkill = z.infer<typeof canonicalSkillSchema>;

/** One composed claim in the snapshot. `entityRef` is the sent x{n}/p{n} it
 *  bound (null for summary); `entityLabel` is its DURABLE resolved display
 *  (company + title for an experience, project name for a project; null for
 *  summary) - snapshotted so a later profile re-import that SET-NULLs the live
 *  FK cannot mutate this reviewed artifact. */
export const canonicalClaimSchema = z.strictObject({
  section: resumeClaimSectionSchema,
  entityRef: z.string().nullable(),
  entityLabel: z.string().nullable(),
  text: z.string(),
  position: z.number().int().min(0),
});
export type CanonicalClaim = z.infer<typeof canonicalClaimSchema>;

export const canonicalResumeDocSchema = z.strictObject({
  contact: canonicalContactSchema,
  education: z.array(canonicalEducationSchema),
  skills: z.array(canonicalSkillSchema),
  claims: z.array(canonicalClaimSchema),
});
export type CanonicalResumeDoc = z.infer<typeof canonicalResumeDocSchema>;

// ---- run + document wire responses ----

/** One compose wire call on the wire - the resumeVariantRun twin (raw_response
 *  and user_id stay off the wire; per-run usage is on deliberately). */
export const resumeComposeRunSchema = z.strictObject({
  id: z.string(),
  promptId: z.string(),
  provider: z.string(),
  model: z.string(),
  status: resumeComposeRunStatusSchema,
  attempt: z.number().int().min(1),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadInputTokens: z.number().int().min(0),
  cacheCreationInputTokens: z.number().int().min(0),
  latencyMs: z.number().int().min(0),
  createdAt: z.iso.datetime(),
});
export type ResumeComposeRun = z.infer<typeof resumeComposeRunSchema>;

/** One provenance citation on the wire. `sourceText` is the DURABLE snapshot of
 *  the cited evidence (the user's own verified prose - safe to display); the
 *  live profile FK is navigation (SET NULL on re-import) and never crosses the
 *  wire, so this snapshot is the provenance shown for review. */
export const resumeDocumentCitationSchema = z.strictObject({
  sourceKind: citationSourceKindSchema,
  sourceText: z.string(),
  position: z.number().int().min(0),
});
export type ResumeDocumentCitation = z.infer<typeof resumeDocumentCitationSchema>;

/** One composed claim on the wire, its citations joined per row, ordered by
 *  (position, id). */
export const resumeDocumentClaimSchema = z.strictObject({
  id: z.string(),
  section: resumeClaimSectionSchema,
  entityRef: z.string().nullable(),
  entityLabel: z.string().nullable(),
  text: z.string(),
  position: z.number().int().min(0),
  citations: z.array(resumeDocumentCitationSchema),
});
export type ResumeDocumentClaim = z.infer<typeof resumeDocumentClaimSchema>;

/** One composed resume document on the wire. `revision` accumulates (redraft
 *  supersedes + drafts N+1); `supersededAt` non-null = a past revision. `stale`
 *  is DERIVED at read time (any compose input postdates this document) - a
 *  warning, not a lock. `canonicalDoc` is the stored snapshot M6-05 renders. */
export const resumeDocumentResponseSchema = z.strictObject({
  id: z.string(),
  fitReportId: z.string(),
  revision: z.number().int().min(1),
  reviewStatus: resumeDocumentReviewStatusSchema,
  supersededAt: z.iso.datetime().nullable(),
  stale: z.boolean(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  canonicalDoc: canonicalResumeDocSchema,
  claims: z.array(resumeDocumentClaimSchema),
});
export type ResumeDocumentResponse = z.infer<typeof resumeDocumentResponseSchema>;

/**
 * POST/GET /fit-reports/:id/resume-document result shape (the
 * fitReportResumeVariantResponse twin). `document: null` = not composed - either
 * not yet drafted (GET) or a non-persisting outcome (a `flagged` gate violation
 * or an `empty` zero-claim draft), with `run.status` the discriminant. 201 = a
 * fresh compose ran and appended run row(s) incl. non-ok/flagged/empty; 200 with
 * `cached: true` = the report's existing current document served with no LLM call
 * (the partial-unique-current index is the cache; a concurrent-race loser also
 * lands here). `run: null` only on a pure GET with no prior compose.
 */
export const fitReportResumeDocumentResponseSchema = z.strictObject({
  run: resumeComposeRunSchema.nullable(),
  document: resumeDocumentResponseSchema.nullable(),
  cached: z.boolean(),
});
export type FitReportResumeDocumentResponse = z.infer<typeof fitReportResumeDocumentResponseSchema>;

/** Cost-free sanity bound on review notes (text column, escaped on render; the
 *  resume_variant / plan / fit review precedent). */
export const RESUME_DOCUMENT_REVIEW_NOTES_MAX_CHARS = 10_000;

// A Postgres text column rejects U+0000 outright - reject at the boundary for a
// value-free 400 instead of a 500 (the resume-variant review-notes precedent).
// NUL via String.fromCharCode(0) so the SOURCE stays printable-ASCII (no raw-NUL
// literal; the source-byte law + the recurring Write-tool escape hazard).
const NUL_CHAR = String.fromCharCode(0);
const notesNoNul = (value: string) => !value.includes(NUL_CHAR);

/** POST /resume-documents/:id/review body - the one-shot draft->reviewed action
 *  (CAS on review_status='draft' AND superseded_at IS NULL). `notes` is nullish;
 *  values trimming to empty are stored NULL at the service boundary. */
export const resumeDocumentReviewBodySchema = z.strictObject({
  notes: z
    .string()
    .max(RESUME_DOCUMENT_REVIEW_NOTES_MAX_CHARS)
    .refine(notesNoNul, 'must not contain U+0000')
    .nullish(),
});
export type ResumeDocumentReviewBody = z.infer<typeof resumeDocumentReviewBodySchema>;

/** Review response is meta-only (no joins): the caller already renders the
 *  document; this confirms the workflow-field transition. */
export const resumeDocumentReviewResponseSchema = z.strictObject({
  id: z.string(),
  reviewStatus: resumeDocumentReviewStatusSchema,
  notes: z.string().nullable(),
});
export type ResumeDocumentReviewResponse = z.infer<typeof resumeDocumentReviewResponseSchema>;
