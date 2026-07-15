import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  applicationCreateBodySchema,
  applicationCreateResponseSchema,
  applicationDetailSchema,
  applicationEventCreateBodySchema,
  applicationEventSchema,
  applicationListResponseSchema,
  applicationSchema,
  applicationStageSchema,
  applicationStageUpdateBodySchema,
  errorEnvelopeSchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type ApplicationsService } from './applications.service.ts';

// Params validate as uuid so a malformed id is a value-free 400 at the
// boundary (VALIDATION_ERROR never echoes), not a Postgres cast error → 500.
const applicationParamsSchema = z.object({ id: z.uuid() });
const applicationListQuerySchema = z.object({
  stage: applicationStageSchema.optional(),
  postingId: z.uuid().optional(),
});

export function applicationsRoutes(services: {
  applications: ApplicationsService;
}): FastifyPluginCallbackZod {
  const { applications } = services;
  return (app, _opts, done) => {
    // Create from a posting (the AC's create path). Guarded by the root auth
    // hook; a mutation, so the CSRF origin check applies (403 on foreign
    // Origin). 200-duplicate mirrors M1-01's ingest: at most one application
    // per posting, and re-tracking returns the stored record, not a 409.
    app.post(
      '/applications',
      {
        schema: {
          body: applicationCreateBodySchema,
          response: {
            200: applicationCreateResponseSchema, // already tracked → stored record + notice
            201: applicationCreateResponseSchema, // created
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema, // posting missing OR foreign, identically
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const result = await applications.create(request.user.id, request.body);
        request.log.info(
          {
            applicationId: result.application.id,
            postingId: result.application.postingId,
            duplicate: result.duplicate,
          },
          result.duplicate ? 'application already tracked' : 'application created',
        );
        return reply.status(result.duplicate ? 200 : 201).send(result);
      },
    );

    // List with SQL-side filters: ?stage= (the AC's filterable list) and
    // ?postingId= (the posting detail page's tracked-state probe). Rows carry
    // posting display metadata only — never rawText (spec tripwire). GETs
    // never mutate, so no CSRF 403 (ADR-0007).
    app.get(
      '/applications',
      {
        schema: {
          querystring: applicationListQuerySchema,
          response: {
            200: applicationListResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return { applications: await applications.list(request.user.id, request.query) };
      },
    );

    // Detail: the application, its posting summary, and the full event trail
    // in chronological order. 404 covers missing AND foreign rows.
    app.get(
      '/applications/:id',
      {
        schema: {
          params: applicationParamsSchema,
          response: {
            200: applicationDetailSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return applications.getDetail(request.user.id, request.params.id);
      },
    );

    // Stage transitions (all user-driven — the M1-02 ownership contrast
    // inverted; no pipeline writer exists or is planned). Any DISTINCT stage
    // is reachable; the service writes the system stage_change event in the
    // same transaction. Same-stage and concurrently-staled updates are the
    // 409. A mutation, so the CSRF origin check applies.
    app.patch(
      '/applications/:id',
      {
        schema: {
          params: applicationParamsSchema,
          body: applicationStageUpdateBodySchema,
          response: {
            200: applicationSchema,
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
        const application = await applications.updateStage(
          request.user.id,
          request.params.id,
          request.body,
        );
        request.log.info(
          { applicationId: application.id, stage: application.stage },
          'application stage updated',
        );
        return application;
      },
    );

    // User-written events: note/outcome only — stage_change is system-only
    // and unrepresentable in the body contract (value-free 400 at
    // validation). Event detail is user-authored, not hostile, but the log
    // line records its LENGTH only — content never enters logs (the posting
    // no-text-in-logs law, applied to details). A mutation → CSRF check.
    app.post(
      '/applications/:id/events',
      {
        schema: {
          params: applicationParamsSchema,
          body: applicationEventCreateBodySchema,
          response: {
            201: applicationEventSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const event = await applications.addEvent(request.user.id, request.params.id, request.body);
        request.log.info(
          {
            applicationId: request.params.id,
            eventId: event.id,
            kind: event.kind,
            detailLength: request.body.detail.length,
          },
          'application event added',
        );
        return reply.status(201).send(event);
      },
    );
    done();
  };
}
