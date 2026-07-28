import { canonicalResumeDocSchema, type AtsCoverageReport } from '@careerforge/core';
import { type ResumeDocumentsRepository } from '@careerforge/db';
import { ATS_COVERAGE_HONESTY, scoreAtsCoverage } from '@careerforge/scoring';

import { DocumentNotFoundError, DocumentSupersededError } from './resume-compose.service.ts';
import { MalformedCanonicalDocError } from './resume-export.service.ts';

// M6-06 (ADR-0018 "ATS Resilience"): the ats-coverage diagnostic over the M6-04
// canonical snapshot. Additive to the compose module - it does NOT touch
// compose/redraft/review/export. Never-trust-the-client (D8a): the ONLY inputs
// are the authenticated userId + the :id path param; the document AND its
// requirements are 100% server-read. Superseded is blocked (409); DRAFT is
// ALLOWED - coverage exists to drive the redraft loop BEFORE review (the
// parse-audit precedent). The scorer is pure (packages/scoring, never imports
// packages/llm); the honesty string is the scorer's own const, added to the wire
// here. Nothing in this path logs claim text, requirement text, or tokens.

export interface ResumeAtsService {
  /** Non-superseded only (DRAFT ALLOWED); scores the current snapshot's coverage
   *  against the report's extracted requirements. 404 not-found/not-owned, 409
   *  superseded, 500 malformed snapshot. */
  coverageForDocument(userId: string, documentId: string): Promise<AtsCoverageReport>;
}

export function createResumeAtsService(deps: {
  documents: ResumeDocumentsRepository;
}): ResumeAtsService {
  const { documents } = deps;
  return {
    async coverageForDocument(userId, documentId) {
      const row = await documents.getDocumentById(userId, documentId);
      if (!row) throw new DocumentNotFoundError();
      if (row.supersededAt !== null) throw new DocumentSupersededError();
      const parsed = canonicalResumeDocSchema.safeParse(row.canonicalDoc);
      if (!parsed.success) throw new MalformedCanonicalDocError();
      // Requirements are re-read server-side from the document's own report - the
      // route accepts NO gate input off the wire (never-trust-the-client). The
      // AtsRequirementRow shape is structurally the scorer's AtsRequirementInput;
      // the call site is the compile-time pin that they stay assignable.
      const requirements = await documents.findRequirementsForDocumentReport(
        userId,
        row.fitReportId,
      );
      const result = scoreAtsCoverage(parsed.data, requirements);
      return { ...result, honesty: ATS_COVERAGE_HONESTY };
    },
  };
}
