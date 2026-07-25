import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  errorEnvelopeSchema,
  interviewPrepResponseSchema,
  interviewPrepReviewBodySchema,
  interviewPrepReviewResponseSchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type InterviewPrepService } from './interview-prep.service.ts';

// Same uuid boundary as every module: malformed ids are a value-free 400.
const idParamsSchema = z.object({ id: z.uuid() });

export function interviewPrepRoutes(services: {
  interviewPrep: InterviewPrepService;
}): FastifyPluginCallbackZod {
  const { interviewPrep } = services;
  return (app, _opts, done) => {
    // The drafting action (M3-04): explicit POST, guarded by the root auth
    // hook, CSRF origin check applies. Posting-scoped: resolves the
    // posting's LATEST fit report and requires it reviewed (404 posting /
    // 409 NO_FIT_REPORT / 409 REPORT_NOT_REVIEWED / 409
    // NO_VERIFIED_REQUIREMENTS before any paid call). One prep per report —
    // the UNIQUE is the cache, an existing prep is served 200 with no LLM
    // call, and there is no force lever (regeneration = re-score). 201
    // covers non-ok/flagged terminal outcomes too: results, not transport
    // errors. Log lines carry ids, statuses, counts, and booleans ONLY —
    // never question/point text, quotes, or skill names.
    app.post(
      '/postings/:id/interview-prep',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: interviewPrepResponseSchema,
            201: interviewPrepResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // no report / not reviewed / nothing verified
            502: errorEnvelopeSchema,
            503: errorEnvelopeSchema, // no LLM provider configured
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const { response, created, telemetry } = await interviewPrep.draft(
          request.user.id,
          request.params.id,
        );
        request.log.info(
          {
            postingId: request.params.id,
            fitReportId: response.prep?.fitReportId ?? null,
            prepId: response.prep?.id ?? null,
            runId: response.run?.id ?? null,
            runStatus: response.run?.status ?? null,
            attempt: response.run?.attempt ?? null,
            questionCount: response.prep?.questions.length ?? 0,
            ...telemetry,
            cached: response.cached,
            created,
          },
          'interview prep draft',
        );
        return reply.status(created ? 201 : 200).send(response);
      },
    );

    // Prep-or-null for the posting's LATEST report (posting must exist; no
    // report at all = the empty collection — a GET carries no
    // preconditions). R2 run selection is the service's contract. GETs never
    // mutate (ADR-0007), no CSRF check. Question/point text and the joined
    // display fields are LLM/posting-derived and UNTRUSTED on display
    // (S-02).
    app.get(
      '/postings/:id/interview-prep',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: interviewPrepResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return interviewPrep.getPrep(request.user.id, request.params.id);
      },
    );

    // One-shot draft→reviewed — a POST workflow action with CAS-event
    // semantics (the M1-10 A2 precedent, fourth application; a NAMED
    // deviation from ARCHITECTURE §5's PATCH row). Body is nullish: a
    // body-less POST reviews with no notes. Notes never reach logs.
    app.post(
      '/interview-preps/:id/review',
      {
        schema: {
          params: idParamsSchema,
          body: interviewPrepReviewBodySchema.nullish(),
          response: {
            200: interviewPrepReviewResponseSchema,
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
        const result = await interviewPrep.review(
          request.user.id,
          request.params.id,
          request.body?.notes,
        );
        request.log.info(
          { prepId: result.id, reviewStatus: result.reviewStatus, hasNotes: result.notes !== null },
          'interview prep reviewed',
        );
        return result;
      },
    );
    done();
  };
}
