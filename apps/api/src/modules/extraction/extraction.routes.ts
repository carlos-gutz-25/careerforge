import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  errorEnvelopeSchema,
  postingExtractBodySchema,
  postingExtractResponseSchema,
  postingRequirementsResponseSchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type ExtractionService } from './extraction.service.ts';

// Same uuid boundary as the postings routes: malformed ids are a value-free
// 400, never a Postgres cast error.
const postingParamsSchema = z.object({ id: z.uuid() });

export function extractionRoutes(services: {
  extraction: ExtractionService;
}): FastifyPluginCallbackZod {
  const { extraction } = services;
  return (app, _opts, done) => {
    // Explicit POST verb — mutating LLM operations never run implicitly
    // (ARCHITECTURE §5). Guarded by the root auth hook; a mutation, so the
    // CSRF origin check applies. The body is optional: a body-less POST is a
    // plain (cached-if-possible) extraction; { force: true } is the explicit
    // append-only re-extraction. The log line carries ids, status, and cost
    // telemetry ONLY — never posting text, requirement text, sourceQuote, or
    // the raw provider response (it can embed posting text).
    app.post(
      '/postings/:id/extract',
      {
        schema: {
          params: postingParamsSchema,
          // nullish, not optional: Fastify surfaces a body-less POST to the
          // validator as null, not undefined.
          body: postingExtractBodySchema.nullish(),
          response: {
            200: postingExtractResponseSchema, // served from the run cache
            201: postingExtractResponseSchema, // fresh run(s) persisted — incl. non-ok terminal outcomes
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // archived posting
            502: errorEnvelopeSchema, // provider threw (error run row persisted first)
            503: errorEnvelopeSchema, // no provider configured
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const force = request.body?.force ?? false;
        const { response, created } = await extraction.extract(
          request.user.id,
          request.params.id,
          force,
        );
        request.log.info(
          {
            postingId: request.params.id,
            runId: response.run.id,
            status: response.run.status,
            attempt: response.run.attempt,
            cached: response.cached,
            force,
            requirementCount: response.requirements.length,
            // Counts only (log privacy law): quote text never reaches logs.
            unverifiedCount: response.requirements.filter(
              (requirement) => requirement.quoteVerified === false,
            ).length,
            inputTokens: response.run.inputTokens,
            outputTokens: response.run.outputTokens,
            latencyMs: response.run.latencyMs,
          },
          response.cached ? 'extraction served from cache' : 'extraction run persisted',
        );
        return reply.status(created ? 201 : 200).send(response);
      },
    );

    // Latest requirement-bearing run (ok or flagged) + its requirements;
    // `run: null` before the first successful extraction (an empty
    // collection, not a 404). GETs never
    // mutate (ADR-0007), so no CSRF check. Requirement text and sourceQuote
    // are posting-derived and UNTRUSTED on display — the response schema
    // carries them as plain strings, and no rawText key exists anywhere on
    // this surface (the openapi drift tripwire pins that).
    app.get(
      '/postings/:id/requirements',
      {
        schema: {
          params: postingParamsSchema,
          response: {
            200: postingRequirementsResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return extraction.getRequirements(request.user.id, request.params.id);
      },
    );
    done();
  };
}
