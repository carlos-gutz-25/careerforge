import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  errorEnvelopeSchema,
  fitReportPlanResponseSchema,
  planItemPatchBodySchema,
  planItemPatchResponseSchema,
  planReviewBodySchema,
  planReviewResponseSchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type PlansService } from './plans.service.ts';

// Same uuid boundary as every module: malformed ids are a value-free 400.
const idParamsSchema = z.object({ id: z.uuid() });

export function plansRoutes(services: { plans: PlansService }): FastifyPluginCallbackZod {
  const { plans } = services;
  return (app, _opts, done) => {
    // The drafting action (M1-12): explicit POST, guarded by the root auth
    // hook, CSRF origin check applies. Requires a REVIEWED report (409);
    // one plan per report — the UNIQUE is the cache, an existing plan is
    // served 200 with no LLM call, and there is no force lever
    // (regeneration = re-score). 201 covers non-ok/flagged terminal
    // outcomes too: results, not transport errors. Log lines carry ids,
    // statuses, counts, and booleans ONLY — never action text, quotes,
    // rationale, or skill names.
    app.post(
      '/fit-reports/:id/improvement-plan',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: fitReportPlanResponseSchema,
            201: fitReportPlanResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // report not reviewed / no actionable gaps
            502: errorEnvelopeSchema,
            503: errorEnvelopeSchema, // no LLM provider configured
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const { response, created, fabricatedRefCount } = await plans.draft(
          request.user.id,
          request.params.id,
        );
        request.log.info(
          {
            fitReportId: request.params.id,
            planId: response.plan?.id ?? null,
            runId: response.run?.id ?? null,
            runStatus: response.run?.status ?? null,
            attempt: response.run?.attempt ?? null,
            itemCount: response.plan?.items.length ?? 0,
            fabricatedRefCount,
            cached: response.cached,
            created,
          },
          'improvement plan draft',
        );
        return reply.status(created ? 201 : 200).send(response);
      },
    );

    // Plan-or-null (an empty collection, not a 404 — the report exists).
    // R2 run selection is the service's contract: the plan's OWN drafting
    // run when a plan exists, latest-by-time only when null. GETs never
    // mutate (ADR-0007), no CSRF check. Action/requirement text in the
    // payload is LLM/posting-derived and UNTRUSTED on display (S-02).
    app.get(
      '/fit-reports/:id/improvement-plan',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: fitReportPlanResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return plans.getPlan(request.user.id, request.params.id);
      },
    );

    // One-shot draft→reviewed — a POST workflow action with CAS-event
    // semantics (the M1-10 A2 precedent, second application; a NAMED
    // deviation from ARCHITECTURE §5's PATCH row). Body is nullish: a
    // body-less POST reviews with no notes. Notes never reach logs.
    app.post(
      '/improvement-plans/:id/review',
      {
        schema: {
          params: idParamsSchema,
          body: planReviewBodySchema.nullish(),
          response: {
            200: planReviewResponseSchema,
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
        const result = await plans.review(request.user.id, request.params.id, request.body?.notes);
        request.log.info(
          { planId: result.id, reviewStatus: result.reviewStatus, hasNotes: result.notes !== null },
          'improvement plan reviewed',
        );
        return result;
      },
    );

    // Item lifecycle edit: PATCH exactly as ARCHITECTURE §5 sketches. FULL
    // REPLACEMENT of the two mutable fields (A2); action/gap/position are
    // immutable by construction (the repository UPDATE cannot touch them).
    // Log lines carry ids and the enum values ONLY — never action text.
    app.patch(
      '/plan-items/:id',
      {
        schema: {
          params: idParamsSchema,
          body: planItemPatchBodySchema,
          response: {
            200: planItemPatchResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const result = await plans.updateItem(request.user.id, request.params.id, request.body);
        request.log.info(
          {
            planItemId: result.id,
            gapId: result.gapId,
            status: result.status,
            priority: result.priority,
          },
          'plan item updated',
        );
        return result;
      },
    );
    done();
  };
}
