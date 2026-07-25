import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  createMasteryEvidenceBodySchema,
  errorEnvelopeSchema,
  masteryEvidenceResponseSchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type MasteryEvidenceService } from './mastery-evidence.service.ts';

// Same uuid boundary as every module: malformed ids are a value-free 400.
const idParamsSchema = z.object({ id: z.uuid() });

export function masteryEvidenceRoutes(services: {
  masteryEvidence: MasteryEvidenceService;
}): FastifyPluginCallbackZod {
  const { masteryEvidence } = services;
  return (app, _opts, done) => {
    // Record a piece of evidence that an exercise was done (M3-03). Guarded by
    // the root auth hook; CSRF origin check applies. Preconditions: exercise
    // owned/exists (404), recordedOn not in the future (400). Log lines carry
    // ids and the kind ONLY — never the artifact URL.
    app.post(
      '/mastery-evidence',
      {
        schema: {
          body: createMasteryEvidenceBodySchema,
          response: {
            201: masteryEvidenceResponseSchema,
            400: errorEnvelopeSchema, // malformed body or a future recordedOn
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema, // exercise not found
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const evidence = await masteryEvidence.create(request.user.id, request.body);
        request.log.info(
          {
            evidenceId: evidence.id,
            exerciseId: evidence.exerciseId,
            kind: evidence.kind,
            hasArtifact: evidence.artifactUrl !== null,
          },
          'mastery evidence recorded',
        );
        return reply.status(201).send(evidence);
      },
    );

    // Owner-scoped delete (the mis-create recourse). The airtight delete-guard
    // (D2) refuses removing the last implemented/tested evidence of a
    // `complete` exercise (409). 204 no-content.
    app.delete(
      '/mastery-evidence/:id',
      {
        schema: {
          params: idParamsSchema,
          response: {
            204: z.null(),
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // would break a completed exercise's evidence
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        await masteryEvidence.remove(request.user.id, request.params.id);
        request.log.info({ evidenceId: request.params.id }, 'mastery evidence deleted');
        // The declared 204 schema is z.null(), so send() needs the explicit
        // null; fastify still emits an empty body for 204.
        return reply.status(204).send(null);
      },
    );
    done();
  };
}
