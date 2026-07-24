import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  createExerciseBodySchema,
  errorEnvelopeSchema,
  exercisePatchBodySchema,
  exerciseResponseSchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type ExercisesService } from './exercises.service.ts';

// Same uuid boundary as every module: malformed ids are a value-free 400.
const idParamsSchema = z.object({ id: z.uuid() });

export function exercisesRoutes(services: {
  exercises: ExercisesService;
}): FastifyPluginCallbackZod {
  const { exercises } = services;
  return (app, _opts, done) => {
    // Create a user-authored exercise (M3-02). Deterministic CRUD, no LLM.
    // Guarded by the root auth hook; CSRF origin check applies. Preconditions:
    // plan owned/exists (404) → gaps cited by that plan (409). Log lines carry
    // ids, enums, and counts ONLY — never the title text.
    app.post(
      '/exercises',
      {
        schema: {
          body: createExerciseBodySchema,
          response: {
            201: exerciseResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema, // learning plan not found
            409: errorEnvelopeSchema, // a cited gap is not in the plan
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const exercise = await exercises.create(request.user.id, request.body);
        request.log.info(
          {
            exerciseId: exercise.id,
            learningPlanId: exercise.learningPlanId,
            kind: exercise.kind,
            status: exercise.status,
            gapCount: exercise.gapIds.length,
          },
          'exercise created',
        );
        return reply.status(201).send(exercise);
      },
    );

    // Lifecycle edit: full-replacement of status (the only mutable field; the
    // plan-items PATCH precedent). Title/kind/plan/links are immutable — a
    // mis-created exercise is DELETEd, not edited.
    app.patch(
      '/exercises/:id',
      {
        schema: {
          params: idParamsSchema,
          body: exercisePatchBodySchema,
          response: {
            200: exerciseResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const exercise = await exercises.updateStatus(
          request.user.id,
          request.params.id,
          request.body,
        );
        request.log.info(
          { exerciseId: exercise.id, status: exercise.status },
          'exercise status updated',
        );
        return exercise;
      },
    );

    // Owner-scoped hard delete (the mis-create recourse); CASCADE clears the
    // exercise's gap links. 204 no-content (the logout precedent).
    app.delete(
      '/exercises/:id',
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
        await exercises.remove(request.user.id, request.params.id);
        request.log.info({ exerciseId: request.params.id }, 'exercise deleted');
        // The declared 204 schema is z.null(), so send() needs the explicit
        // null; fastify still emits an empty body for 204.
        return reply.status(204).send(null);
      },
    );
    done();
  };
}
