import {
  errorEnvelopeSchema,
  fitReportResumeDocumentResponseSchema,
  resumeDocumentReviewBodySchema,
  resumeDocumentReviewResponseSchema,
} from '@careerforge/core';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type ResumeComposeService } from './resume-compose.service.ts';

// M6-04 (ADR-0018): the Resume Studio COMPOSED artifact routes (distinct from
// the M2-10 tailoring GUIDE routes). Root auth hook + CSRF on the mutating
// POSTs. The route reads NO gate input from the client (REQUIRED-1): only the
// :id path param + request.user; even the claims originate server-side (the
// service's own runPrompt call). Logs carry ids/statuses/counts/booleans ONLY -
// never claim text, posting text, or link values.
const idParamsSchema = z.object({ id: z.uuid() });

export function resumeComposeRoutes(services: {
  resumeCompose: ResumeComposeService;
}): FastifyPluginCallbackZod {
  const { resumeCompose } = services;
  return (app, _opts, done) => {
    // Cache-or-compose. Requires a REVIEWED report (409). 200 = existing current
    // document served (cache; the concurrent-race loser also lands here). 201 =
    // a fresh compose ran, incl. the flagged/empty terminals (document:null,
    // run.status the discriminant - results, not transport errors).
    app.post(
      '/fit-reports/:id/resume-document',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: fitReportResumeDocumentResponseSchema,
            201: fitReportResumeDocumentResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // report not reviewed / profile incomplete
            500: errorEnvelopeSchema, // malformed stored contact links
            502: errorEnvelopeSchema,
            503: errorEnvelopeSchema, // no LLM provider configured
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const { response, created, violationCount, claimCount } = await resumeCompose.compose(
          request.user.id,
          request.params.id,
        );
        request.log.info(
          {
            fitReportId: request.params.id,
            documentId: response.document?.id ?? null,
            runId: response.run?.id ?? null,
            runStatus: response.run?.status ?? null,
            attempt: response.run?.attempt ?? null,
            revision: response.document?.revision ?? null,
            claimCount,
            violationCount,
            cached: response.cached,
            created,
          },
          'resume document composed',
        );
        return reply.status(created ? 201 : 200).send(response);
      },
    );

    // Current document-or-null (an empty collection, not a 404 - the report
    // exists). GETs never mutate, no CSRF.
    app.get(
      '/fit-reports/:id/resume-document',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: fitReportResumeDocumentResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return resumeCompose.getDocument(request.user.id, request.params.id);
      },
    );

    // Redraft: supersede the current document (CAS) + compose revision N+1.
    app.post(
      '/resume-documents/:id/redraft',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: fitReportResumeDocumentResponseSchema,
            201: fitReportResumeDocumentResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // not the current revision
            500: errorEnvelopeSchema,
            502: errorEnvelopeSchema,
            503: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const { response, created, violationCount, claimCount } = await resumeCompose.redraft(
          request.user.id,
          request.params.id,
        );
        request.log.info(
          {
            documentId: request.params.id,
            newDocumentId: response.document?.id ?? null,
            runId: response.run?.id ?? null,
            runStatus: response.run?.status ?? null,
            revision: response.document?.revision ?? null,
            claimCount,
            violationCount,
            created,
          },
          'resume document redrafted',
        );
        return reply.status(created ? 201 : 200).send(response);
      },
    );

    // One-shot draft->reviewed CAS (guarded on draft AND not superseded). Notes
    // never reach logs.
    app.post(
      '/resume-documents/:id/review',
      {
        schema: {
          params: idParamsSchema,
          body: resumeDocumentReviewBodySchema.nullish(),
          response: {
            200: resumeDocumentReviewResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // already reviewed / superseded
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const result = await resumeCompose.review(
          request.user.id,
          request.params.id,
          request.body?.notes,
        );
        request.log.info(
          {
            documentId: result.id,
            reviewStatus: result.reviewStatus,
            hasNotes: result.notes !== null,
          },
          'resume document reviewed',
        );
        return result;
      },
    );
    done();
  };
}
