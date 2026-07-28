import {
  canonicalResumeDocSchema,
  type CanonicalResumeDoc,
  type ParseAuditReport,
  type ResumeAuditFormat,
  type ResumeExportFormat,
} from '@careerforge/core';
import { type ResumeDocumentsRepository } from '@careerforge/db';
import { auditParse, renderResume, type RenderedResume } from '@careerforge/resume-render';

import { DocumentNotFoundError, DocumentSupersededError } from './resume-compose.service.ts';

// M6-05 (ADR-0018): the export + parse-audit surface over the M6-04 canonical
// snapshot. Additive to the compose module - it does NOT touch compose/redraft/
// review. Never-trust-the-client (D9): the ONLY inputs are the authenticated
// userId, the :id path param, and the ?format enum; the rendered content is 100%
// server-read from the document's own canonicalDoc. The reviewed/superseded
// status is re-derived server-side from the DB row, never trusted from the wire.
// Renders stream buffers in memory - ZERO server file writes (P-01). Nothing here
// logs claim text, contact fields, link values, or extracted text.

/** A draft document cannot be exported (export is reviewed-only; the current
 *  revision only). Distinct from DocumentSupersededError so draft vs superseded
 *  report different 409 codes. */
export class DocumentNotExportableError extends Error {
  readonly statusCode = 409;
  readonly code = 'DOCUMENT_NOT_EXPORTABLE';
  constructor() {
    super('resume document is still a draft - review the current revision before exporting');
  }
}

/** A data-integrity failure: the stored canonicalDoc jsonb did not match the
 *  snapshot schema at the read boundary (zod-at-every-boundary). Value-free -
 *  a malformed snapshot is a 500, never silently rendered. */
export class MalformedCanonicalDocError extends Error {
  readonly statusCode = 500;
  readonly code = 'MALFORMED_CANONICAL_DOC';
  constructor() {
    super('stored resume document snapshot is malformed');
  }
}

export interface ResumeExportService {
  /** Reviewed + non-superseded only; renders the current snapshot to a streamable
   *  artifact. 404 not-found/not-owned, 409 draft (not exportable) / superseded,
   *  500 malformed snapshot. */
  exportDocument(
    userId: string,
    documentId: string,
    format: ResumeExportFormat,
  ): Promise<RenderedResume>;
  /** Non-superseded only (DRAFT ALLOWED - a diagnostic that helps the reviewer
   *  decide); renders the requested binary format and re-reads it for a
   *  render-fidelity report. 404, 409 superseded, 500 malformed snapshot. */
  auditDocument(
    userId: string,
    documentId: string,
    format: ResumeAuditFormat,
  ): Promise<ParseAuditReport>;
}

export function createResumeExportService(deps: {
  documents: ResumeDocumentsRepository;
}): ResumeExportService {
  const { documents } = deps;

  /** Load the CURRENT (non-superseded) document owned by userId, re-validating
   *  its snapshot at the jsonb read boundary. Superseded is blocked for BOTH
   *  routes; the reviewed gate is applied by the export caller only. */
  async function loadCurrent(
    userId: string,
    documentId: string,
  ): Promise<{
    reviewStatus: string;
    doc: CanonicalResumeDoc;
  }> {
    const row = await documents.getDocumentById(userId, documentId);
    if (!row) throw new DocumentNotFoundError();
    if (row.supersededAt !== null) throw new DocumentSupersededError();
    const parsed = canonicalResumeDocSchema.safeParse(row.canonicalDoc);
    if (!parsed.success) throw new MalformedCanonicalDocError();
    return { reviewStatus: row.reviewStatus, doc: parsed.data };
  }

  return {
    async exportDocument(userId, documentId, format) {
      const { reviewStatus, doc } = await loadCurrent(userId, documentId);
      if (reviewStatus !== 'reviewed') throw new DocumentNotExportableError();
      return renderResume(format, doc);
    },

    async auditDocument(userId, documentId, format) {
      const { doc } = await loadCurrent(userId, documentId);
      const rendered = await renderResume(format, doc);
      return auditParse(format, rendered.body as Buffer, doc);
    },
  };
}
