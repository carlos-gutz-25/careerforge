import {
  createDemoBlueprintBodySchema,
  demoBlueprintCreateResultSchema,
  demoBlueprintSchema,
  demoBlueprintsResponseSchema,
  errorEnvelopeSchema,
} from '@careerforge/core';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type DemoBlueprintsService } from './demo-blueprints.service.ts';

// M9-04 (V2-PLAN 3.5): demo-blueprints endpoints, all under the root auth guard.
// The POST re-derives Build eligibility server-side from the live market signal
// (never-trust-the-client, D2). Log lines carry ids + counts + a verdict CODE
// only - never requirement/title/section text (posting-derived text reaches the
// client as data, never the logs).

// Same uuid boundary as every module: malformed ids are a value-free 400.
const idParamsSchema = z.object({ id: z.uuid() });

export function demoBlueprintsRoutes(services: {
  demoBlueprints: DemoBlueprintsService;
}): FastifyPluginCallbackZod {
  const { demoBlueprints } = services;
  return (app, _opts, done) => {
    // Scaffold a demo blueprint for a market-signal BUILD group (M9-04), or
    // REFRESH the group's existing blueprint in place (full-replacement). The
    // body carries only the anchor gapId (+ optional title); the server
    // recomputes the signal and re-derives eligibility (zero client trust). 201
    // on first create, 200 on refresh. 404 gap-not-found; 409 gap-not-in-signal
    // or not-a-Build-recommendation.
    app.post(
      '/demo-blueprints',
      {
        schema: {
          body: createDemoBlueprintBodySchema,
          response: {
            200: demoBlueprintCreateResultSchema, // refreshed in place
            201: demoBlueprintCreateResultSchema, // newly created
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema, // CSRF origin
            404: errorEnvelopeSchema, // gap not found
            409: errorEnvelopeSchema, // not in signal, or not a Build recommendation
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const { demoBlueprint, created } = await demoBlueprints.create(
          request.user.id,
          request.body,
        );
        request.log.info(
          {
            demoBlueprintId: demoBlueprint.id,
            postingCount: demoBlueprint.postingCount,
            linkedExercises: demoBlueprint.linkedExercises.length,
            created,
          },
          'demo blueprint scaffolded',
        );
        return reply.status(created ? 201 : 200).send({ demoBlueprint, created });
      },
    );

    // List the user's demo blueprints (sections + linkedExercises omitted - the
    // list is a picker). Read-only, no CSRF. (created_at desc, id desc) order.
    app.get(
      '/demo-blueprints',
      {
        schema: {
          response: {
            200: demoBlueprintsResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const list = await demoBlueprints.list(request.user.id);
        request.log.info({ demoBlueprintCount: list.length }, 'demo blueprints read');
        return { demoBlueprints: list };
      },
    );

    // One blueprint incl. its sections + computed linkedExercises. Read-only.
    app.get(
      '/demo-blueprints/:id',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: demoBlueprintSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return demoBlueprints.get(request.user.id, request.params.id);
      },
    );

    // Owner-scoped hard delete (the mis-create / drop-the-brief recourse). 204.
    app.delete(
      '/demo-blueprints/:id',
      {
        schema: {
          params: idParamsSchema,
          response: {
            204: z.null(),
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        await demoBlueprints.remove(request.user.id, request.params.id);
        request.log.info({ demoBlueprintId: request.params.id }, 'demo blueprint deleted');
        return reply.status(204).send(null);
      },
    );

    done();
  };
}
