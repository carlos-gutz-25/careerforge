import { z } from 'zod';

import {
  citationSourceKindSchema,
  requirementCategorySchema,
  requirementKindSchema,
  resumeComposeRunStatusSchema,
  resumeDocumentReviewStatusSchema,
  skillLevelSchema,
} from './enums.ts';
import { profileContactLinksSchema } from './profile.ts';
import { resumeClaimSectionSchema, resumeGateViolationSchema } from './resume-compose.ts';

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
  /** M15-01 - the violations behind this run's verdict. TRI-STATE, and the three
   *  states are not interchangeable: `null` = the gate never ran for this row
   *  (a non-final retry, a non-ok LLM result, or any row predating the column);
   *  `[]` = it ran and found nothing; non-empty = these are the violations.
   *  REQUIRED but nullable on purpose - `.optional()` would add a fourth state
   *  (absent), and a consumer must be able to tell "not recorded" from "clean". */
  gateViolations: z.array(resumeGateViolationSchema).nullable(),
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

// ---- M6-05 export/render contracts (ADR-0018) ----
// packages/resume-render renders the canonicalDoc into these formats; the api
// export route's `?format=` query and the pure package share this ONE enum so
// the route and the renderer can never disagree on the allowed set.

/** The five deterministic export formats (GET /resume-documents/:id/export). */
export const RESUME_EXPORT_FORMATS = ['pdf', 'docx', 'markdown', 'plaintext', 'json'] as const;
export const resumeExportFormatSchema = z.enum(RESUME_EXPORT_FORMATS);
export type ResumeExportFormat = z.infer<typeof resumeExportFormatSchema>;

/** The two binary formats a parse-audit can round-trip (md/txt/json have no
 *  binary artifact to re-extract). */
export const RESUME_AUDIT_FORMATS = ['pdf', 'docx'] as const;
export const resumeAuditFormatSchema = z.enum(RESUME_AUDIT_FORMATS);
export type ResumeAuditFormat = z.infer<typeof resumeAuditFormatSchema>;

/** Structural round-trip result. `missing`/`outOfOrder` carry STRUCTURAL ANCHOR
 *  LABELS only - `contact.fullName` and the fixed section-heading names - never
 *  dynamic claim/contact VALUES (D10 no-echo; ADVISORY-C2). */
export const parseIntegrityResultSchema = z.strictObject({
  ok: z.boolean(),
  missing: z.array(z.string()),
  outOfOrder: z.array(z.string()),
});
export type ParseIntegrityResult = z.infer<typeof parseIntegrityResultSchema>;

/** Evidence round-trip result. `missingClaims` carries the POSITIONS of any
 *  claim whose text did not survive the round-trip - never the claim text. */
export const evidenceIntegrityResultSchema = z.strictObject({
  ok: z.boolean(),
  missingClaims: z.array(z.number().int().min(0)),
});
export type EvidenceIntegrityResult = z.infer<typeof evidenceIntegrityResultSchema>;

/** The parse-audit report (GET /resume-documents/:id/parse-audit). TWO SEPARATE,
 *  never-merged render-fidelity results (V2-PLAN 59 "never one merged score") +
 *  a fixed render-fidelity honesty string. This is render-fidelity only (does the
 *  exported file still contain every reviewed claim, in order) - NOT any ATS or
 *  coverage prediction (that is M6-06, kept structurally separate). */
export const parseAuditReportSchema = z.strictObject({
  parseIntegrity: parseIntegrityResultSchema,
  evidenceIntegrity: evidenceIntegrityResultSchema,
  honesty: z.string(),
});
export type ParseAuditReport = z.infer<typeof parseAuditReportSchema>;

// ---- ATS coverage report (M6-06, ADR-0018 "ATS Resilience") ----
// GET /resume-documents/:id/ats-coverage. THREE SEPARATE, never-merged
// deterministic results (V2-PLAN 59 "never one merged 'ATS score'"): per-
// requirement coverage, a keyword-stuffing lint, and a length-balance check +
// a fixed honesty string. `scorerVersion` (not a clock/persistence) is the
// reproducibility anchor - inputs are the immutable canonicalDoc snapshot + the
// report's extracted requirements. The `packages/scoring` scorer computes the
// three results and OWNS the honesty const; the wire schema (this file, beside
// parse-audit) is the single source of truth for the shapes the scorer builds.
// z.strictObject everywhere so an accidental blended-score field is a schema
// error, never a silent drift. Requirement `text` is posting-derived UNTRUSTED
// display (S-02: served as data; the UI escapes) - the same law the fit and
// interview responses already carry.

/** One matched doc location for a requirement (the "with evidence" clause).
 *  Identity fields (name/email/phone/location/links) are NOT content surfaces,
 *  so no location kind references them - coverage measures what the resume SAYS. */
export const atsEvidenceLocationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('claim'),
    section: resumeClaimSectionSchema,
    position: z.number().int().min(0),
  }),
  z.strictObject({ kind: z.literal('skill'), name: z.string() }),
  z.strictObject({ kind: z.literal('headline') }),
  z.strictObject({ kind: z.literal('education'), index: z.number().int().min(0) }),
]);
export type AtsEvidenceLocation = z.infer<typeof atsEvidenceLocationSchema>;

export const atsRequirementStatusSchema = z.enum(['hit', 'partial', 'miss']);
export type AtsRequirementStatus = z.infer<typeof atsRequirementStatusSchema>;

/** One requirement's coverage row. `matchedTokens`/`unmatchedTokens`/
 *  `contentTokenCount` make every verdict explainable (no opaque score). Tri-
 *  state `quoteVerified` is CARRIED, never filtered (D3: read-only diagnostic,
 *  not an LLM payload - the strict ===true filter is an LLM-payload law).
 *  `evidence` is capped (`matchedSourceCount` discloses the pre-cap total);
 *  `suggestion` is ABSENT for a hit (present for partial/miss). */
export const atsRequirementCoverageRowSchema = z.strictObject({
  requirementId: z.string(),
  text: z.string(),
  kind: requirementKindSchema,
  category: requirementCategorySchema,
  quoteVerified: z.boolean().nullable(),
  status: atsRequirementStatusSchema,
  ratio: z.number(),
  contentTokenCount: z.number().int().min(0),
  matchedTokens: z.array(z.string()),
  unmatchedTokens: z.array(z.string()),
  matchedSourceCount: z.number().int().min(0),
  evidence: z.array(atsEvidenceLocationSchema),
  suggestion: z.string().optional(),
});
export type AtsRequirementCoverageRow = z.infer<typeof atsRequirementCoverageRowSchema>;

export const atsRequirementCoverageSchema = z.strictObject({
  requirements: z.array(atsRequirementCoverageRowSchema),
  counts: z.strictObject({
    hit: z.number().int().min(0),
    partial: z.number().int().min(0),
    miss: z.number().int().min(0),
  }),
});
export type AtsRequirementCoverage = z.infer<typeof atsRequirementCoverageSchema>;

/** Keyword-stuffing lint over CLAIM prose only (D4). ADVISORY - it blocks
 *  nothing server-side (drafts are already draft-until-reviewed); the human
 *  reviews with the flags in hand. `density` = round4(count / totalClaimTokens). */
export const atsKeywordStuffingSchema = z.strictObject({
  ok: z.boolean(),
  totalClaimTokens: z.number().int().min(0),
  flaggedTokens: z.array(
    z.strictObject({
      token: z.string(),
      count: z.number().int().min(0),
      density: z.number(),
    }),
  ),
});
export type AtsKeywordStuffing = z.infer<typeof atsKeywordStuffingSchema>;

export const atsLengthSectionSchema = z.enum([
  'summary',
  'experience',
  'project',
  'skills',
  'education',
  'headline',
]);
export type AtsLengthSection = z.infer<typeof atsLengthSectionSchema>;

/** Advisory length-balance flags, each a pinned const with a pinned threshold. */
export const atsLengthFlagSchema = z.enum([
  'total-short',
  'total-long',
  'summary-heavy',
  'skills-heavy',
]);
export type AtsLengthFlag = z.infer<typeof atsLengthFlagSchema>;

/** Length balance over DISPLAY strings (simple whitespace word counts, not the
 *  matching normalizer - display-honest counting). `share` = round4(words /
 *  totalWords); every section row is present even at 0. Flags are ADVISORY. */
export const atsLengthBalanceSchema = z.strictObject({
  totalWords: z.number().int().min(0),
  sections: z.array(
    z.strictObject({
      section: atsLengthSectionSchema,
      words: z.number().int().min(0),
      share: z.number(),
    }),
  ),
  flags: z.array(atsLengthFlagSchema),
});
export type AtsLengthBalance = z.infer<typeof atsLengthBalanceSchema>;

/** The ATS coverage report (200 of GET /resume-documents/:id/ats-coverage).
 *  THREE separate never-merged results + the fixed honesty string; NO aggregate
 *  field spans them (the "never one merged 'ATS score'" law, structural via
 *  strictObject). This is deterministic keyword/structure diagnostics only -
 *  never a prediction of any real ATS (that ceiling IS the honesty copy). */
export const atsCoverageReportSchema = z.strictObject({
  scorerVersion: z.number().int(),
  honesty: z.string(),
  requirementCoverage: atsRequirementCoverageSchema,
  keywordStuffing: atsKeywordStuffingSchema,
  lengthBalance: atsLengthBalanceSchema,
});
export type AtsCoverageReport = z.infer<typeof atsCoverageReportSchema>;
