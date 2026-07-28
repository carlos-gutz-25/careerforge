import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  applicationGameplanResponseSchema,
  errorEnvelopeSchema,
  gameplanCheckToggleBodySchema,
  gameplanChecklistResponseSchema,
  gameplanReviewBodySchema,
  gameplanReviewResponseSchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type GameplanService } from './gameplan.service.ts';

// M7-07 (ADR-0019 layer L3): the gameplan routes. Posting-scoped drafting +
// read, plus the one-shot review CAS and the checklist toggle. Same uuid
// boundary as every module (a malformed id is a value-free 400); every response
// key zod-declared incl. the error envelopes. Error classes carry
// statusCode/code; the central error handler maps them to errorEnvelopeSchema.
const idParamsSchema = z.object({ id: z.uuid() });

export function gameplanRoutes(services: { gameplan: GameplanService }): FastifyPluginCallbackZod {
  const { gameplan } = services;
  return (app, _opts, done) => {
    // The drafting action. Cache-once, no force lever (ADR-0019 consequence B):
    // an existing gameplan is served 200 cached with no LLM call; regeneration =
    // re-score. 201 covers fresh outcomes INCLUDING non-ok/flagged terminals
    // (results, not transport errors; run.status is the discriminant, gameplan
    // null). 502/503 are transport failures.
    app.post(
      '/postings/:id/gameplan',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: applicationGameplanResponseSchema,
            201: applicationGameplanResponseSchema,
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
        const { response, created, telemetry } = await gameplan.draft(
          request.user.id,
          request.params.id,
        );
        request.log.info(
          {
            postingId: request.params.id,
            fitReportId: response.gameplan?.fitReportId ?? null,
            gameplanId: response.gameplan?.id ?? null,
            runId: response.run?.id ?? null,
            runStatus: response.run?.status ?? null,
            attempt: response.run?.attempt ?? null,
            storyCount: response.gameplan?.stories.length ?? 0,
            ...telemetry,
            cached: response.cached,
            created,
          },
          'gameplan draft',
        );
        return reply.status(created ? 201 : 200).send(response);
      },
    );

    // Gameplan-or-null for the posting's LATEST report (404 posting only; a GET
    // carries no preconditions - no report reads as an empty collection).
    app.get(
      '/postings/:id/gameplan',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: applicationGameplanResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return gameplan.getGameplan(request.user.id, request.params.id);
      },
    );

    // The one-shot draft->reviewed CAS. Body nullish (a body-less POST reaches
    // the validator as null).
    app.post(
      '/application-gameplans/:id/review',
      {
        schema: {
          params: idParamsSchema,
          body: gameplanReviewBodySchema.nullish(),
          response: {
            200: gameplanReviewResponseSchema,
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
        const result = await gameplan.review(
          request.user.id,
          request.params.id,
          request.body?.notes,
        );
        request.log.info(
          {
            gameplanId: result.id,
            reviewStatus: result.reviewStatus,
            hasNotes: result.notes !== null,
          },
          'gameplan reviewed',
        );
        return result;
      },
    );

    // The checklist toggle (D6). Allowed regardless of reviewStatus; returns the
    // FULL checklist overlay so the UI never computes state client-side.
    app.post(
      '/application-gameplans/:id/checks',
      {
        schema: {
          params: idParamsSchema,
          body: gameplanCheckToggleBodySchema,
          response: {
            200: gameplanChecklistResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const result = await gameplan.toggleCheck(
          request.user.id,
          request.params.id,
          request.body.checkKey,
          request.body.done,
        );
        request.log.info(
          {
            gameplanId: request.params.id,
            checkKey: request.body.checkKey,
            done: request.body.done,
          },
          'gameplan check toggled',
        );
        return result;
      },
    );
    done();
  };
}
