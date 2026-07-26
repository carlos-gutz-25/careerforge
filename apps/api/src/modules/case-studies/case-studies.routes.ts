import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  caseStudiesResponseSchema,
  caseStudyResponseSchema,
  createCaseStudyBodySchema,
  errorEnvelopeSchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type CaseStudiesService } from './case-studies.service.ts';

// Same uuid boundary as every module: malformed ids are a value-free 400.
const idParamsSchema = z.object({ id: z.uuid() });

export function caseStudiesRoutes(services: {
  caseStudies: CaseStudiesService;
}): FastifyPluginCallbackZod {
  const { caseStudies } = services;
  return (app, _opts, done) => {
    // Generate a case-study draft from a completed exercise (M4-01), or REFRESH
    // the exercise's existing draft. OD-1 semantics — this POST is intentionally
    // NOT idempotent-create: a repeat POST while the draft is unpublished
    // re-renders and FULLY REPLACES the stored snapshot (200), because the
    // inputs legitimately change as evidence accrues. The replacement is TOTAL:
    // an OMITTED `title` on a refresh RESETS the stored title back to the
    // exercise title (it does not preserve a previously-custom title). 201 on
    // first create; 409 once published (locked). The server re-derives every
    // section from the exercise + evidence + gap-link state (zero client trust,
    // incl. the exercise's completion status). Log lines carry ids/status ONLY —
    // never titles or markdown (user-authored, UNTRUSTED).
    app.post(
      '/case-studies',
      {
        schema: {
          body: createCaseStudyBodySchema,
          response: {
            200: caseStudyResponseSchema, // refreshed in place
            201: caseStudyResponseSchema, // newly created
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema, // CSRF origin
            404: errorEnvelopeSchema, // exercise not found
            409: errorEnvelopeSchema, // not complete, or already published
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const { caseStudy, created } = await caseStudies.create(request.user.id, request.body);
        request.log.info(
          {
            caseStudyId: caseStudy.id,
            status: caseStudy.status,
            provenance: caseStudy.provenance,
            created,
          },
          'case-study draft generated',
        );
        return reply.status(created ? 201 : 200).send(caseStudy);
      },
    );

    // List the user's case-study drafts (markdown omitted — the list is a
    // picker). Read-only, no CSRF. (created_at, id) order.
    app.get(
      '/case-studies',
      {
        schema: {
          response: {
            200: caseStudiesResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const caseStudyList = await caseStudies.list(request.user.id);
        request.log.info({ caseStudyCount: caseStudyList.length }, 'case studies read');
        return { caseStudies: caseStudyList };
      },
    );

    // One draft incl. its rendered markdown. Read-only, no CSRF.
    app.get(
      '/case-studies/:id',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: caseStudyResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return caseStudies.get(request.user.id, request.params.id);
      },
    );

    // Markdown export — the stored rendered_markdown byte-for-byte. Deliberately
    // has NO status gate (OD-5): the inverse of resume export (reviewed-only) —
    // here the DRAFT is the product, feeding the manual authoring step. The 200
    // bypasses the zod JSON serializer (identity serializer + explicit
    // content-type) so the body is raw markdown, not a quoted JSON string; error
    // responses stay zod-declared. The filename is uuid-only (nothing injectable
    // in the header).
    app.get(
      '/case-studies/:id/export',
      {
        schema: {
          params: idParamsSchema,
          response: {
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const { filename, markdown } = await caseStudies.export(request.user.id, request.params.id);
        request.log.info(
          { caseStudyId: request.params.id, bytes: Buffer.byteLength(markdown, 'utf8') },
          'case study exported',
        );
        // The 200 has no zod response schema (raw markdown, not JSON), so the
        // send payload type is the error union — cast past it. The identity
        // serializer sends the string verbatim.
        return reply
          .type('text/markdown; charset=utf-8')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .serializer((payload: unknown) => payload as string)
          .send(markdown as never);
      },
    );

    // One-way CAS flip draft->published (OD-2: a CAS event POST, not a PATCH —
    // the M1-10 review-verb lineage). "Published" = taken into the portfolio;
    // it locks refresh. 404 unknown, 409 already published.
    app.post(
      '/case-studies/:id/publish',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: caseStudyResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // already published
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const caseStudy = await caseStudies.publish(request.user.id, request.params.id);
        request.log.info(
          { caseStudyId: caseStudy.id, status: caseStudy.status },
          'case study published',
        );
        return caseStudy;
      },
    );

    // Owner-scoped hard delete at ANY status (OD-4: the mis-publish recourse —
    // the row is local bookkeeping, so DELETE + re-POST is always available).
    // 204 no-content.
    app.delete(
      '/case-studies/:id',
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
        await caseStudies.remove(request.user.id, request.params.id);
        request.log.info({ caseStudyId: request.params.id }, 'case study deleted');
        return reply.status(204).send(null);
      },
    );

    done();
  };
}
