import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  criteriaPutBodySchema,
  criteriaResponseSchema,
  errorEnvelopeSchema,
} from '@careerforge/core';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type CriteriaService } from './criteria.service.ts';

export function criteriaRoutes(services: { criteria: CriteriaService }): FastifyPluginCallbackZod {
  const { criteria } = services;
  return (app, _opts, done) => {
    // Guarded by the root auth hook (no `config.public`); reads the session
    // user's single row only. Criteria values are private profile data: this
    // authenticated response is their one wire path — never logs. No 403:
    // GETs never mutate, so the CSRF origin check doesn't run (ADR-0007).
    app.get(
      '/criteria',
      {
        schema: {
          response: {
            200: criteriaResponseSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return criteria.getCriteria(request.user.id);
      },
    );

    // Full-document replace with a compare-and-swap pin (the body's
    // expectedUpdatedAt); conflicts are 409, invalid shapes are the
    // value-free 400 VALIDATION_ERROR path. A mutation, so the CSRF origin
    // check runs (ADR-0007) — hence 403 in the contract.
    app.put(
      '/criteria',
      {
        schema: {
          body: criteriaPutBodySchema,
          response: {
            200: criteriaResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            409: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return criteria.replaceCriteria(request.user.id, request.body);
      },
    );
    done();
  };
}
