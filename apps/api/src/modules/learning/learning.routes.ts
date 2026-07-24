import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  createLearningPlanBodySchema,
  errorEnvelopeSchema,
  learningPlanListResponseSchema,
  learningPlanResponseSchema,
  learningPlanReviewBodySchema,
  learningPlanReviewResponseSchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type LearningService } from './learning.service.ts';

// Same uuid boundary as every module: malformed ids are a value-free 400.
const idParamsSchema = z.object({ id: z.uuid() });

export function learningRoutes(services: { learning: LearningService }): FastifyPluginCallbackZod {
  const { learning } = services;
  return (app, _opts, done) => {
    // The drafting action (M3-01): explicit POST, guarded by the root auth
    // hook, CSRF origin check applies. FREE-CREATE — every successful draft is
    // a fresh plan (201); there is no cache-200 (a learning plan is plural by
    // design, ADR-0013). 201 covers non-ok/flagged terminal outcomes too:
    // results, not transport errors. Log lines carry ids, statuses, counts, and
    // booleans ONLY — never focus text, title, quotes, rationale, or skill
    // names.
    app.post(
      '/learning-plans',
      {
        schema: {
          body: createLearningPlanBodySchema,
          response: {
            201: learningPlanResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema, // one or more selected gaps not found
            409: errorEnvelopeSchema, // reports not reviewed / no actionable gaps
            502: errorEnvelopeSchema,
            503: errorEnvelopeSchema, // no LLM provider configured
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const { response, fabricatedRefCount } = await learning.draft(
          request.user.id,
          request.body,
        );
        request.log.info(
          {
            planId: response.plan?.id ?? null,
            runId: response.run?.id ?? null,
            runStatus: response.run?.status ?? null,
            attempt: response.run?.attempt ?? null,
            gapCount: response.plan?.gaps.length ?? 0,
            selectedGapCount: request.body.gapIds.length,
            fabricatedRefCount,
          },
          'learning plan draft',
        );
        return reply.status(201).send(response);
      },
    );

    // All of the user's learning plans, newest first (plural by design). GETs
    // never mutate (ADR-0007), no CSRF check. Titles are LLM-derived and
    // UNTRUSTED on display (S-02).
    app.get(
      '/learning-plans',
      {
        schema: {
          response: {
            200: learningPlanListResponseSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return learning.list(request.user.id);
      },
    );

    // One plan with its cited gaps, or 404 (missing/foreign — one outcome).
    // focus + gap display fields are LLM/posting-derived and UNTRUSTED (S-02).
    app.get(
      '/learning-plans/:id',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: learningPlanResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return learning.getPlan(request.user.id, request.params.id);
      },
    );

    // One-shot draft→reviewed — a POST workflow action with CAS-event semantics
    // (the M1-12 precedent; a NAMED deviation from ARCHITECTURE §5's PATCH row).
    // Body is nullish: a body-less POST reviews with no notes. Notes never
    // reach logs.
    app.post(
      '/learning-plans/:id/review',
      {
        schema: {
          params: idParamsSchema,
          body: learningPlanReviewBodySchema.nullish(),
          response: {
            200: learningPlanReviewResponseSchema,
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
        const result = await learning.review(
          request.user.id,
          request.params.id,
          request.body?.notes,
        );
        request.log.info(
          { planId: result.id, reviewStatus: result.reviewStatus, hasNotes: result.notes !== null },
          'learning plan reviewed',
        );
        return result;
      },
    );
    done();
  };
}
