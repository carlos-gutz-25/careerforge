import {
  CLAIM_PROVENANCE_LAWS,
  profileContactLinksSchema,
  type CanonicalClaim,
  type ClaimProvenanceLaw,
  type CanonicalResumeDoc,
  type CitationSourceKind,
  type FitReportResumeDocumentResponse,
  type ResumeComposeRun,
  type ResumeDocumentClaim,
  type ResumeClaimDraft,
  type ResumeDocumentResponse,
  type ResumeDocumentReviewResponse,
  type ResumeGateViolation,
} from '@careerforge/core';
import {
  deriveComposeRunStatus,
  type ComposeCitationInsert,
  type ComposeClaimInsert,
  type ComposeDocumentInsert,
  type ComposeInputs,
  type ComposeRunInsert,
  type DocumentWithClaims,
  type ResumeComposeRunRow,
  type ResumeDocumentsRepository,
} from '@careerforge/db';
import {
  buildComposePayload,
  resumeComposeV1,
  runPrompt,
  type ComposeEntities,
  type ComposeEvidenceItem,
  type ComposePayload,
  type LlmCallRecord,
  type LlmProvider,
} from '@careerforge/llm';
import { checkClaimProvenance } from '@careerforge/scoring';

import { toSafeGateViolations } from './gate-violations.ts';
import { stripNulChars, toPlainJson } from '../extraction/extraction.service.ts';

// M6-04 (ADR-0018): the Resume Studio COMPOSED-with-provenance service. Mirrors
// the M2-10 tailoring service (build payload -> runPrompt -> validate -> persist)
// with the composed-path deltas: the deterministic validator is
// checkClaimProvenance (packages/scoring - M6-04 is its first and only caller);
// the single policy site is deriveComposeRunStatus; any gate violation flags the
// run and writes nothing; the persisted artifact is a revisioned document +
// claims + a citation provenance ledger, snapshotted into canonicalDoc. Error
// classes live with the service. Nothing here logs labels, reasons, quotes, or
// claim/posting text.

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
    super('fit report is still a draft - review it before composing a resume');
  }
}

export class ProfileIncompleteError extends Error {
  readonly statusCode = 409;
  readonly code = 'PROFILE_INCOMPLETE';
  constructor() {
    super('no contact information on file - a composed resume needs a contact header');
  }
}

/** A data-integrity failure: profile_contact.links jsonb did not match the
 *  {label, url}[] shape at the read boundary (obligation 1). Value-free. */
export class MalformedContactLinksError extends Error {
  readonly statusCode = 500;
  readonly code = 'MALFORMED_CONTACT_LINKS';
  constructor() {
    super('stored contact links are malformed');
  }
}

export class DocumentNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    super('resume document not found');
  }
}

export class DocumentAlreadyReviewedError extends Error {
  readonly statusCode = 409;
  readonly code = 'DOCUMENT_ALREADY_REVIEWED';
  constructor() {
    super('resume document is already reviewed');
  }
}

export class DocumentSupersededError extends Error {
  readonly statusCode = 409;
  readonly code = 'DOCUMENT_SUPERSEDED';
  constructor() {
    super('resume document has been superseded by a newer revision');
  }
}

export class DocumentNotCurrentError extends Error {
  readonly statusCode = 409;
  readonly code = 'DOCUMENT_NOT_CURRENT';
  constructor() {
    super('resume document is not the current revision');
  }
}

export class LlmNotConfiguredError extends Error {
  readonly statusCode = 503;
  readonly code = 'LLM_NOT_CONFIGURED';
  constructor() {
    super('no LLM provider configured - set ANTHROPIC_API_KEY');
  }
}

export class LlmUpstreamError extends Error {
  readonly statusCode = 502;
  readonly code = 'LLM_UPSTREAM_ERROR';
  constructor(errorName: string, auditNote: string) {
    super(`LLM provider call failed: ${errorName}${auditNote}`);
  }
}

export interface ComposeResult {
  response: FitReportResumeDocumentResponse;
  /** false = existing current document served, no LLM call (HTTP 200); true = a
   *  fresh wire call ran (HTTP 201 - incl. flagged/empty terminals). */
  created: boolean;
  /** Value-free route-log telemetry: > 0 iff the run landed 'flagged'. */
  violationCount: number;
  /** M15-01 - the DISTINCT law ids behind this run's verdict, for the route log.
   *  TRI-STATE like the column: `null` = the gate never ran, `[]` = it ran and
   *  found nothing, non-empty = these laws fired. Law ids are a closed
   *  vocabulary carrying no PII and no posting text, so they are lawful under
   *  the pino no-PII rule - which is why the log gets ids only and the DB gets
   *  the full safe record.
   *
   *  REQUIRED, not optional, and that is load-bearing rather than stylistic:
   *  four return sites carry `violationCount`, and an optional field would let
   *  any of them compile while silently omitting this one, which reads as
   *  `undefined` - a fourth state the contract forbids. Requiredness makes the
   *  compiler enumerate the sites instead of leaving them to a grep. */
  violatedLaws: ClaimProvenanceLaw[] | null;
  claimCount: number;
}

export interface ResumeComposeService {
  compose(userId: string, reportId: string): Promise<ComposeResult>;
  getDocument(userId: string, reportId: string): Promise<FitReportResumeDocumentResponse>;
  redraft(userId: string, documentId: string): Promise<ComposeResult>;
  review(
    userId: string,
    documentId: string,
    notes: string | null | undefined,
  ): Promise<ResumeDocumentReviewResponse>;
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** One citation insert with exactly one source FK set (the INSERT-time
 *  exactly-one invariant the DB CHECK relaxes to at-most-one for SET-NULL
 *  tolerance). */
function citation(
  sourceKind: CitationSourceKind,
  sourceText: string,
  fk: Partial<
    Pick<
      ComposeCitationInsert,
      'experienceBulletId' | 'masteryEvidenceId' | 'projectId' | 'summaryId'
    >
  >,
): ComposeCitationInsert {
  return {
    sourceKind,
    sourceText,
    experienceBulletId: fk.experienceBulletId ?? null,
    masteryEvidenceId: fk.masteryEvidenceId ?? null,
    projectId: fk.projectId ?? null,
    summaryId: fk.summaryId ?? null,
  };
}

/** `gateViolations` is a REQUIRED third parameter, not an optional one with a
 *  default: every caller must state whether the gate ran for the row it is
 *  building. Only the FINAL run of a compose whose LLM result was `ok` can pass
 *  a non-null value; every non-final retry and every non-ok terminal passes
 *  `null`, because the gate was never called for them. */
function toRunInsert(
  record: LlmCallRecord,
  status: ComposeRunInsert['status'],
  gateViolations: ResumeGateViolation[] | null,
): ComposeRunInsert {
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
    status,
    gateViolations,
    createdAt: new Date(record.timestamp),
  };
}

function toWireRun(row: ResumeComposeRunRow): ResumeComposeRun {
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
    gateViolations: row.gateViolations,
  };
}

/** Join stored claim rows with the canonicalDoc snapshot (matched by position:
 *  entityRef/entityLabel are the durable snapshot, the row FKs are navigation).
 *  Citation sourceText is the durable snapshot on the row; the FK may be NULL
 *  after a profile re-import. */
function toWireDocument(stored: DocumentWithClaims): ResumeDocumentResponse {
  const canonicalClaimByPosition = new Map<number, CanonicalClaim>();
  for (const claim of stored.document.canonicalDoc.claims) {
    canonicalClaimByPosition.set(claim.position, claim);
  }
  const claims: ResumeDocumentClaim[] = stored.claims.map(({ claim, citations }) => {
    const snapshot = canonicalClaimByPosition.get(claim.position);
    return {
      id: claim.id,
      section: claim.section,
      entityRef: snapshot?.entityRef ?? null,
      entityLabel: snapshot?.entityLabel ?? null,
      text: claim.text,
      position: claim.position,
      citations: citations.map((citation) => ({
        sourceKind: citation.sourceKind,
        sourceText: citation.sourceText,
        position: citation.position,
      })),
    };
  });
  return {
    id: stored.document.id,
    fitReportId: stored.document.fitReportId,
    revision: stored.document.revision,
    reviewStatus: stored.document.reviewStatus,
    supersededAt: stored.document.supersededAt?.toISOString() ?? null,
    stale: stored.stale,
    notes: stored.document.notes,
    createdAt: stored.document.createdAt.toISOString(),
    canonicalDoc: stored.document.canonicalDoc,
    claims,
  };
}

/** REQUIRED-1 / obligation 5: the compose builder's sent-set types are passed
 *  straight into checkClaimProvenance with NO cast or adapter. These aliases
 *  make the call site's structural bridge explicit; the dedicated
 *  resume-compose.provenance-pin.test.ts pins it bidirectionally so any drift
 *  between the llm mirror and the scoring input fails typecheck here. */
type GateEvidence = ComposeEvidenceItem;
type GateEntities = ComposeEntities;

export function createResumeComposeService(deps: {
  documents: ResumeDocumentsRepository;
  provider: LlmProvider | undefined;
  now?: () => number;
}): ResumeComposeService {
  const { documents, provider } = deps;

  function cachedResponse(stored: DocumentWithClaims): FitReportResumeDocumentResponse {
    return { run: null, document: toWireDocument(stored), cached: true };
  }

  /** Build the persist insert (claims + citations + canonicalDoc) from the gated
   *  claims and the server-derived builder output. Citation sources are
   *  classified by id-membership in the read-sets (R7): each cited ev-ref
   *  resolves to a source id that is a bullet / project / summary id (mastery
   *  evidence carries no prose and is never a compose source in M6-04). */
  function buildDocumentInsert(
    claims: ResumeClaimDraft[],
    built: ComposePayload,
    inputs: ComposeInputs,
    contactLinks: { label: string; url: string }[],
  ): ComposeDocumentInsert {
    const experienceById = new Map(inputs.experiences.map((e) => [e.experienceId, e]));
    const projectById = new Map(inputs.projects.map((p) => [p.projectId, p]));
    const bulletIds = new Set(inputs.experiences.flatMap((e) => e.bullets.map((b) => b.bulletId)));
    const projectIds = new Set(inputs.projects.map((p) => p.projectId));
    const summaryIds = new Set(inputs.summaries.map((s) => s.summaryId));
    const evidenceByRef = new Map(built.evidence.map((item) => [item.ref, item]));

    const claimInserts: ComposeClaimInsert[] = [];
    const canonicalClaims: CanonicalClaim[] = [];

    claims.forEach((claim, position) => {
      let experienceId: string | null = null;
      let projectId: string | null = null;
      let entityLabel: string | null = null;
      if (claim.section === 'experience' && claim.entityRef !== null) {
        experienceId = built.experienceIdByRef.get(claim.entityRef) ?? null;
        const experience = experienceId === null ? undefined : experienceById.get(experienceId);
        entityLabel = experience ? `${experience.company} - ${experience.title}` : null;
      } else if (claim.section === 'project' && claim.entityRef !== null) {
        projectId = built.projectIdByRef.get(claim.entityRef) ?? null;
        const project = projectId === null ? undefined : projectById.get(projectId);
        entityLabel = project ? project.name : null;
      }

      const citations: ComposeCitationInsert[] = claim.citationRefs.map((ref) => {
        const sourceId = built.evidenceIdByRef.get(ref);
        const evidence = evidenceByRef.get(ref);
        if (sourceId === undefined || evidence === undefined) {
          throw new Error('gate-passed claim cites an unknown evidence ref');
        }
        const sourceText = evidence.sourceText;
        if (bulletIds.has(sourceId)) {
          return citation('experience_bullet', sourceText, { experienceBulletId: sourceId });
        }
        if (projectIds.has(sourceId)) {
          return citation('project', sourceText, { projectId: sourceId });
        }
        if (summaryIds.has(sourceId)) {
          return citation('summary', sourceText, { summaryId: sourceId });
        }
        // Conservative tie-break (R7): an unclassifiable id is a real anomaly.
        throw new Error('gate-passed claim cites an id in no known source set');
      });

      claimInserts.push({
        section: claim.section,
        experienceId,
        projectId,
        text: claim.text,
        citations,
      });
      canonicalClaims.push({
        section: claim.section,
        entityRef: claim.entityRef,
        entityLabel,
        text: claim.text,
        position,
      });
    });

    const contact = inputs.contact;
    if (!contact) throw new Error('unreachable: contact checked before compose');
    const canonicalDoc: CanonicalResumeDoc = {
      contact: {
        fullName: contact.fullName,
        headline: contact.headline,
        email: contact.email,
        phone: contact.phone,
        location: contact.location,
        links: contactLinks,
      },
      education: inputs.education.map((e) => ({
        institution: e.institution,
        credential: e.credential,
        startYear: e.startYear,
        endYear: e.endYear,
      })),
      skills: inputs.skills.map((s) => ({ name: s.name, level: s.level })),
      claims: canonicalClaims,
    };
    return { canonicalDoc, claims: claimInserts };
  }

  async function runCompose(userId: string, reportId: string): Promise<ComposeResult> {
    const inputs = await documents.getComposeInputs(userId, reportId);
    // obligation 1: zod at the profile_contact.links jsonb read boundary.
    if (!inputs.contact) throw new ProfileIncompleteError();
    const linksResult = profileContactLinksSchema.safeParse(inputs.contact.links);
    if (!linksResult.success) throw new MalformedContactLinksError();
    const contactLinks = linksResult.data;

    // Map server-derived rows onto the builder inputs. Mastery evidence carries
    // no user-authored prose (kind/url/date) and its exercise prompt is
    // LLM-generated, so it is NOT a citable compose source in M6-04 (passed
    // empty); the mastery_evidence citation FK/kind is retained for a future
    // prose-bearing story.
    const built = buildComposePayload(
      inputs.experiences.map((e) => ({
        experienceId: e.experienceId,
        company: e.company,
        title: e.title,
        bullets: e.bullets,
        masteryEvidence: [],
      })),
      inputs.projects.map((p) => ({
        projectId: p.projectId,
        name: p.name,
        provenance: p.provenance,
        experienceId: p.experienceId,
        description: p.description,
      })),
      inputs.skills.map((s) => ({ skillId: s.skillId, name: s.name, level: s.level })),
      inputs.summaries.map((s) => ({ summaryId: s.summaryId, text: s.text })),
      { requirements: inputs.guidance.requirements, gaps: inputs.guidance.gaps },
    );

    if (!provider) throw new LlmNotConfiguredError();

    const records: LlmCallRecord[] = [];
    let result;
    try {
      result = await runPrompt(
        resumeComposeV1,
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
        await documents.persistComposeOutcome(
          userId,
          reportId,
          // The LlmUpstreamError catch path: the gate was never reached, so every
          // audit row this writes carries null.
          records.map((record) => toRunInsert(record, record.status, null)),
          undefined,
        );
      } catch {
        auditNote = ` (audit record persistence also failed; ${String(records.length)} record(s) lost)`;
      }
      throw new LlmUpstreamError(errorName, auditNote);
    }

    // Gate + the SINGLE POLICY SITE. Every gate input except the claims is the
    // server-derived builder sent-set - never client-supplied (REQUIRED-1). The
    // builder's evidence/entities are passed with NO cast (obligation 5: the
    // structural bridge IS the compile-time pin).
    let violationCount = 0;
    let claimCount = 0;
    // M15-01 - TRI-STATE, and the discriminant is "did the gate run", NEVER the
    // status. The `null` initializer must survive if and only if the outer
    // `result.status === 'ok'` block below is never entered, because that block
    // is the only place checkClaimProvenance is called. Do NOT mirror
    // `violationCount`'s assignment site: 0 is correct for both "ran clean" and
    // "never ran", so assigning it inside the inner violations-only branch is
    // harmless by luck, but this field must DISTINGUISH those two cases.
    let gateViolationsPayload: ResumeGateViolation[] | null = null;
    let violatedLaws: ClaimProvenanceLaw[] | null = null;
    let documentInsert: ComposeDocumentInsert | undefined;
    let finalStatus: ComposeRunInsert['status'];
    if (result.status === 'ok') {
      const claims = result.output.claims;
      claimCount = claims.length;
      const evidence: GateEvidence[] = built.evidence;
      const entities: GateEntities = built.entities;
      const verdict = checkClaimProvenance({
        claims,
        evidence,
        entities,
        skillVocabulary: built.skillVocabulary,
      });
      const gateViolated = verdict.ok === false;
      if (verdict.ok === false) violationCount = verdict.violations.length;
      // Assigned UNCONDITIONALLY here, immediately after the verdict: the gate
      // ran, so the honest value is `[]` when it found nothing and the projected
      // payload when it did. `verdict`'s existence IS the "gate ran" signal.
      gateViolationsPayload =
        verdict.ok === false ? toSafeGateViolations(verdict.violations, claims) : [];
      violatedLaws =
        verdict.ok === false
          ? [...new Set(verdict.violations.map((violation) => violation.law))].sort(
              (a, b) => CLAIM_PROVENANCE_LAWS.indexOf(a) - CLAIM_PROVENANCE_LAWS.indexOf(b),
            )
          : [];
      finalStatus = deriveComposeRunStatus('ok', gateViolated, claims.length === 0);
      if (finalStatus === 'ok') {
        documentInsert = buildDocumentInsert(claims, built, inputs, contactLinks);
      }
    } else {
      finalStatus = result.status;
    }

    const lastIndex = records.length - 1;
    const outcome = await documents.persistComposeOutcome(
      userId,
      reportId,
      records.map((record, index) =>
        // Only the FINAL run can carry a payload, and only when the gate ran for
        // it. Every non-final retry passes null: the gate was never called for it.
        index === lastIndex
          ? toRunInsert(record, finalStatus, gateViolationsPayload)
          : toRunInsert(record, record.status, null),
      ),
      documentInsert,
    );

    if (outcome.conflicted) {
      // REQUIRED-2 race recovery: a concurrent compose won; serve the winner.
      const winner = await documents.findCurrentDocument(userId, reportId);
      if (!winner) throw new Error('conflicted persist but no current document found');
      // Always [] here, never null and never non-empty: reaching the conflicted
      // branch requires a documentInsert, which requires the gate to have PASSED.
      return {
        response: cachedResponse(winner),
        created: false,
        violationCount,
        violatedLaws,
        claimCount,
      };
    }

    const finalRun = outcome.runs[outcome.runs.length - 1];
    if (!finalRun) throw new Error('compose persisted no runs');

    if (outcome.document) {
      const stored = await documents.findCurrentDocument(userId, reportId);
      if (!stored) throw new Error('document persisted but not readable');
      return {
        response: { run: toWireRun(finalRun), document: toWireDocument(stored), cached: false },
        created: true,
        violationCount,
        violatedLaws,
        claimCount,
      };
    }

    // flagged / empty / non-ok terminal: run recorded, nothing written. All
    // three land here, so `violatedLaws` carries whichever of the three states
    // the outer gate block left: non-empty (flagged), [] (empty), or the
    // surviving null initializer (the LLM result was never ok, so no gate ran).
    return {
      response: { run: toWireRun(finalRun), document: null, cached: false },
      created: true,
      violationCount,
      violatedLaws,
      claimCount,
    };
  }

  return {
    async compose(userId, reportId) {
      const report = await documents.findReportById(userId, reportId);
      if (!report) throw new ReportNotFoundError();
      // REQUIRED-1: re-derive review status server-side; never trust the client.
      if (report.reviewStatus !== 'reviewed') throw new ReportNotReviewedError();

      const existing = await documents.findCurrentDocument(userId, reportId);
      if (existing) {
        return {
          response: cachedResponse(existing),
          created: false,
          violationCount: 0,
          // A cache hit serves an existing current document with no compose at
          // all, so the gate genuinely never ran for this request. The literal
          // 0 above is ambiguous between "ran clean" and "never ran"; this is
          // the field that distinguishes them, so it must be null, not [].
          violatedLaws: null,
          claimCount: existing.claims.length,
        };
      }
      return runCompose(userId, reportId);
    },

    async getDocument(userId, reportId) {
      const report = await documents.findReportById(userId, reportId);
      if (!report) throw new ReportNotFoundError();
      const stored = await documents.findCurrentDocument(userId, reportId);
      return stored
        ? { run: null, document: toWireDocument(stored), cached: false }
        : { run: null, document: null, cached: false };
    },

    async redraft(userId, documentId) {
      const anchor = await documents.findDocumentById(userId, documentId);
      if (!anchor) throw new DocumentNotFoundError();
      // The supersede-CAS is the serializer: only its winner composes N+1.
      const superseded = await documents.supersedeDocument(userId, documentId);
      if (superseded.kind === 'not_found') throw new DocumentNotFoundError();
      if (superseded.kind === 'not_current') throw new DocumentNotCurrentError();
      return runCompose(userId, anchor.document.fitReportId);
    },

    async review(userId, documentId, notes) {
      const outcome = await documents.markDocumentReviewed(
        userId,
        documentId,
        trimmedOrNull(notes),
      );
      if (outcome.kind === 'not_found') throw new DocumentNotFoundError();
      if (outcome.kind === 'superseded') throw new DocumentSupersededError();
      if (outcome.kind === 'already_reviewed') throw new DocumentAlreadyReviewedError();
      return {
        id: outcome.document.id,
        reviewStatus: outcome.document.reviewStatus,
        notes: outcome.document.notes,
      };
    },
  };
}
