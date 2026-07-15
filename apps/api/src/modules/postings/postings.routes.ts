import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  errorEnvelopeSchema,
  postingDetailSchema,
  postingIngestBodySchema,
  postingIngestResponseSchema,
  postingListResponseSchema,
  postingSchema,
  postingStatusUpdateBodySchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type PostingsService } from './postings.service.ts';

// Params validate as uuid so a malformed id is a value-free 400 at the
// boundary (VALIDATION_ERROR never echoes), not a Postgres cast error → 500.
const postingParamsSchema = z.object({ id: z.uuid() });

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

    // List: metadata ONLY (packages/core postingSchema). rawText's single
    // wire path is the detail GET below — pinned by exact-shape tests here
    // and by the spec tripwire (openapi-drift.test.ts). GETs never mutate,
    // so no CSRF 403 (ADR-0007).
    app.get(
      '/postings',
      {
        schema: {
          response: {
            200: postingListResponseSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return { postings: await postings.list(request.user.id) };
      },
    );

    // Detail: THE one response carrying rawText — UNTRUSTED, byte-identical
    // to the paste; the client renders it escaped (RISKS S-02). 404 covers
    // missing AND foreign rows (user-scoped read). The log line carries the
    // posting id only — posting text never enters logs.
    app.get(
      '/postings/:id',
      {
        schema: {
          params: postingParamsSchema,
          response: {
            200: postingDetailSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return postings.getDetail(request.user.id, request.params.id);
      },
    );

    // Status transitions (M1-02): body enum admits USER-settable statuses
    // only — pipeline states (extracted/scored, M1-05/M1-09) are
    // unrepresentable and 400 value-free at validation. From-state rules and
    // the 409 live in the service. A mutation, so the CSRF origin check
    // applies (403 on foreign Origin).
    app.patch(
      '/postings/:id',
      {
        schema: {
          params: postingParamsSchema,
          body: postingStatusUpdateBodySchema,
          response: {
            200: postingSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const posting = await postings.updateStatus(
          request.user.id,
          request.params.id,
          request.body,
        );
        request.log.info(
          { postingId: posting.id, status: posting.status },
          'posting status updated',
        );
        return posting;
      },
    );
    done();
  };
}
