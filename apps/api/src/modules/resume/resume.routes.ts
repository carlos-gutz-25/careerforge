import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  errorEnvelopeSchema,
  fitReportResumeVariantResponseSchema,
  resumeVariantReviewBodySchema,
  resumeVariantReviewResponseSchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type ResumeService } from './resume.service.ts';

// Same uuid boundary as every module: malformed ids are a value-free 400.
const idParamsSchema = z.object({ id: z.uuid() });

export function resumeRoutes(services: { resume: ResumeService }): FastifyPluginCallbackZod {
  const { resume } = services;
  return (app, _opts, done) => {
    // The tailoring action (M2-10): explicit POST, root auth hook + CSRF check.
    // Requires a REVIEWED report (409); one variant per report — the UNIQUE is
    // the cache, an existing variant is served 200 with no LLM call, no force
    // lever. 201 covers non-ok/flagged terminals (results, not transport
    // errors). Logs carry ids/statuses/counts/booleans ONLY — never labels,
    // reasons, quotes, or markdown.
    app.post(
      '/fit-reports/:id/resume-variant',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: fitReportResumeVariantResponseSchema,
            201: fitReportResumeVariantResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // report not reviewed / nothing to tailor
            502: errorEnvelopeSchema,
            503: errorEnvelopeSchema, // no LLM provider configured
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const { response, created, fabricatedRefCount, missingRefCount } = await resume.draft(
          request.user.id,
          request.params.id,
        );
        request.log.info(
          {
            fitReportId: request.params.id,
            variantId: response.variant?.id ?? null,
            runId: response.run?.id ?? null,
            runStatus: response.run?.status ?? null,
            attempt: response.run?.attempt ?? null,
            entryCount: response.variant?.entries.length ?? 0,
            fabricatedRefCount,
            missingRefCount,
            cached: response.cached,
            created,
          },
          'resume variant tailored',
        );
        return reply.status(created ? 201 : 200).send(response);
      },
    );

    // Variant-or-null (an empty collection, not a 404 — the report exists).
    // R2 run selection is the service's contract. GETs never mutate, no CSRF.
    app.get(
      '/fit-reports/:id/resume-variant',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: fitReportResumeVariantResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return resume.getVariant(request.user.id, request.params.id);
      },
    );

    // One-shot draft→reviewed CAS (the plans-review precedent). Notes never
    // reach logs.
    app.post(
      '/resume-variants/:id/review',
      {
        schema: {
          params: idParamsSchema,
          body: resumeVariantReviewBodySchema.nullish(),
          response: {
            200: resumeVariantReviewResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // already reviewed
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const result = await resume.review(request.user.id, request.params.id, request.body?.notes);
        request.log.info(
          {
            variantId: result.id,
            reviewStatus: result.reviewStatus,
            hasNotes: result.notes !== null,
          },
          'resume variant reviewed',
        );
        return result;
      },
    );

    // Markdown export — ONLY a reviewed variant (409 on a draft). The stored
    // rendered_markdown is served byte-for-byte. The 200 bypasses the zod JSON
    // serializer (identity serializer + explicit content-type) so the body is
    // raw markdown, not a quoted JSON string; error responses stay zod-declared.
    // The filename is uuid-only — nothing injectable in the header.
    app.get(
      '/resume-variants/:id/export',
      {
        schema: {
          params: idParamsSchema,
          response: {
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // not reviewed
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const { filename, markdown } = await resume.export(request.user.id, request.params.id);
        request.log.info(
          { variantId: request.params.id, bytes: Buffer.byteLength(markdown, 'utf8') },
          'resume variant exported',
        );
        // The 200 has no zod response schema (raw markdown, not JSON), so the
        // send payload type is the error union — cast past it. The identity
        // serializer sends the string verbatim.
        return reply
          .type('text/markdown; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .serializer((payload: unknown) => payload as string)
          .send(markdown as never);
      },
    );
    done();
  };
}
