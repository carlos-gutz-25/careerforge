import {
  errorEnvelopeSchema,
  parseAuditReportSchema,
  resumeAuditFormatSchema,
  resumeExportFormatSchema,
} from '@careerforge/core';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type ResumeExportService } from './resume-export.service.ts';

// M6-05 (ADR-0018): the export + parse-audit routes. Additive to the M6-04
// compose module; both GET (non-mutating -> the CSRF origin check does not
// apply), both behind the root auth guard. `?format=` is the repo's first
// content-negotiation query param. Never-trust-the-client (D9): the only inputs
// are :id + ?format + request.user; nothing renderable comes off the wire. Logs
// carry ids / format / byte-length / booleans ONLY - never claim text, contact
// fields, link values, or extracted text (D10).
const idParamsSchema = z.object({ id: z.uuid() });

export function resumeExportRoutes(services: {
  resumeExport: ResumeExportService;
}): FastifyPluginCallbackZod {
  const { resumeExport } = services;
  return (app, _opts, done) => {
    // Export the rendered file. Reviewed + non-superseded only (409). The 200 has
    // NO response schema (raw bytes/string, not JSON) - the identity serializer
    // bypasses the zod JSON serializer so the body streams RAW; error responses
    // stay zod-declared. The 200 is therefore absent from OpenAPI by omission (no
    // binary-response spec problem - the resume-variant/case-studies precedent).
    // ZERO server file writes (P-01): the buffer is built in memory and streamed.
    app.get(
      '/resume-documents/:id/export',
      {
        schema: {
          params: idParamsSchema,
          querystring: z.object({ format: resumeExportFormatSchema }),
          response: {
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema, // not found / not owned
            409: errorEnvelopeSchema, // draft (not exportable) / superseded
            500: errorEnvelopeSchema, // malformed stored snapshot
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const rendered = await resumeExport.exportDocument(
          request.user.id,
          request.params.id,
          request.query.format,
        );
        const bytes = Buffer.isBuffer(rendered.body)
          ? rendered.body.length
          : Buffer.byteLength(rendered.body, 'utf8');
        request.log.info(
          { documentId: request.params.id, format: request.query.format, bytes },
          'resume document exported',
        );
        // The 200 has no zod response schema (raw file, not JSON), so the send
        // payload type is the error union - cast past it. The identity serializer
        // sends the Buffer/string verbatim (the resume-variant export precedent).
        return reply
          .type(rendered.contentType)
          .header('content-disposition', `attachment; filename="${rendered.filename}"`)
          .serializer((payload: unknown) => payload as string)
          .send(rendered.body as never);
      },
    );

    // Parse-audit (render-fidelity). Intentionally NOT reviewed-gated - a
    // diagnostic that helps the reviewer decide - only superseded-gated (409).
    // Returns the JSON report (two separate never-merged results + honesty
    // string). pdf|docx only (md/txt/json have no binary round-trip).
    app.get(
      '/resume-documents/:id/parse-audit',
      {
        schema: {
          params: idParamsSchema,
          querystring: z.object({ format: resumeAuditFormatSchema }),
          response: {
            200: parseAuditReportSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // superseded
            500: errorEnvelopeSchema, // malformed stored snapshot
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const report = await resumeExport.auditDocument(
          request.user.id,
          request.params.id,
          request.query.format,
        );
        request.log.info(
          {
            documentId: request.params.id,
            format: request.query.format,
            parseOk: report.parseIntegrity.ok,
            evidenceOk: report.evidenceIntegrity.ok,
          },
          'resume document parse-audited',
        );
        return reply.send(report);
      },
    );
    done();
  };
}
