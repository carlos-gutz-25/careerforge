import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  confirmCriteriaAdjustmentBodySchema,
  confirmCriteriaAdjustmentResponseSchema,
  criteriaAdjustmentsResponseSchema,
  criteriaSuggestionsResponseSchema,
  errorEnvelopeSchema,
} from '@careerforge/core';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type CriteriaAdjustmentsService } from './criteria-adjustments.service.ts';

// M4-02 routes (Outcomes -> matching feedback). Log lines carry counts + ids +
// the closed kind enum ONLY — NEVER slugs, company/title, or criteria payloads
// (criteria.routes.ts:16-17 law; criteria values are private profile data).

export function criteriaAdjustmentsRoutes(services: {
  criteriaAdjustments: CriteriaAdjustmentsService;
}): FastifyPluginCallbackZod {
  const { criteriaAdjustments } = services;
  return (app, _opts, done) => {
    // Deterministically-derived criteria-adjustment suggestions (M4-02):
    // outcome data (screens/rejections) argues to REMOVE a signal slug.
    // Recomputed on every GET — nothing stored, nothing stale. 200 always
    // (ok | insufficient_data); GETs never mutate (ADR-0007), no CSRF.
    app.get(
      '/criteria-suggestions',
      {
        schema: {
          response: {
            200: criteriaSuggestionsResponseSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const result = await criteriaAdjustments.getSuggestions(request.user.id);
        request.log.info(
          {
            status: result.status,
            suggestionCount: result.suggestions.length,
            analyzable: result.totals.analyzable,
          },
          'criteria suggestions read',
        );
        return result;
      },
    );

    // Confirm and apply an adjustment (M4-02). Guarded by the root auth hook;
    // CSRF origin check applies. The server RE-DERIVES the full suggestion list
    // from current state (zero client trust) and pins the criteria swap to the
    // caller's expectedUpdatedAt: 404 no criteria (before 409), 409 not derivable
    // / stale pin. Log lines carry the id + closed kind enum ONLY.
    app.post(
      '/criteria-adjustments',
      {
        schema: {
          body: confirmCriteriaAdjustmentBodySchema,
          response: {
            201: confirmCriteriaAdjustmentResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema, // CSRF origin
            404: errorEnvelopeSchema, // no criteria yet
            409: errorEnvelopeSchema, // not derivable, or stale pin
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const result = await criteriaAdjustments.confirm(request.user.id, request.body);
        request.log.info(
          { adjustmentId: result.adjustment.id, kind: result.adjustment.kind },
          'criteria adjustment confirmed',
        );
        return reply.status(201).send(result);
      },
    );

    // The append-only audit list (what was adjusted + the frozen evidence).
    // Read-only, no CSRF.
    app.get(
      '/criteria-adjustments',
      {
        schema: {
          response: {
            200: criteriaAdjustmentsResponseSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const result = await criteriaAdjustments.listAdjustments(request.user.id);
        request.log.info(
          { adjustmentCount: result.adjustments.length },
          'criteria adjustments read',
        );
        return result;
      },
    );

    done();
  };
}
