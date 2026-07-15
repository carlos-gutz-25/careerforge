import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  errorEnvelopeSchema,
  postingIngestBodySchema,
  postingIngestResponseSchema,
} from '@careerforge/core';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type PostingsService } from './postings.service.ts';

export function postingsRoutes(services: { postings: PostingsService }): FastifyPluginCallbackZod {
  const { postings } = services;
  return (app, _opts, done) => {
    // Guarded by the root auth hook (no `config.public`); a mutation, so the
    // CSRF origin check applies (403 on foreign Origin). Posting text is
    // UNTRUSTED from this route on (CLAUDE.md hard rule): body validation is
    // value-free (the error handler's VALIDATION_ERROR branch never echoes
    // received values), the response carries no rawText, and the log line
    // below records the LENGTH only — full posting text never enters logs.
    app.post(
      '/postings',
      {
        schema: {
          body: postingIngestBodySchema,
          response: {
            200: postingIngestResponseSchema, // duplicate paste → stored record + notice
            201: postingIngestResponseSchema, // created
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            413: errorEnvelopeSchema, // transport backstop (Fastify bodyLimit)
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const result = await postings.ingest(request.user.id, request.body);
        request.log.info(
          {
            postingId: result.posting.id,
            duplicate: result.duplicate,
            rawTextLength: request.body.rawText.length,
          },
          result.duplicate ? 'posting paste deduplicated' : 'posting ingested',
        );
        return reply.status(result.duplicate ? 200 : 201).send(result);
      },
    );
    done();
  };
}
