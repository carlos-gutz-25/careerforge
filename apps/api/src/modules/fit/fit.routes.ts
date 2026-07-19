import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  errorEnvelopeSchema,
  fitReportGapsResponseSchema,
  fitReportResponseSchema,
  fitReviewBodySchema,
  fitReviewResponseSchema,
  gapOverrideBodySchema,
  gapOverrideResponseSchema,
  postingFitResponseSchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type FitService } from './fit.service.ts';

// Same uuid boundary as the postings routes: malformed ids are a value-free
// 400, never a Postgres cast error.
const idParamsSchema = z.object({ id: z.uuid() });

export function fitRoutes(services: { fit: FitService }): FastifyPluginCallbackZod {
  const { fit } = services;
  return (app, _opts, done) => {
    // Explicit POST verb (mutations never run implicitly); guarded by the
    // root auth hook, CSRF origin check applies. Always scores fresh and
    // APPENDS (M1-09 law) — deterministic and LLM-free, so no cache and no
    // force lever; a double-fired POST costs two identical rows and GET
    // stays deterministic. Log lines carry ids, verdict, counts, and
    // booleans ONLY — never quotes, rationale text, or criteria slugs
    // (rationale embeds criteria-adjacent vocabulary).
    app.post(
      '/postings/:id/fit',
      {
        schema: {
          params: idParamsSchema,
          response: {
            201: fitReportResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema, // posting or criteria (code disambiguates)
            409: errorEnvelopeSchema, // archived, or no requirement-bearing run
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const { report, postingFlipped } = await fit.score(request.user.id, request.params.id);
        request.log.info(
          {
            postingId: request.params.id,
            fitReportId: report.id,
            extractionRunId: report.extractionRunId,
            verdict: report.report.verdict,
            exclusionCount: report.report.exclusions.length,
            subScoreCount: report.report.subScores.length,
            evidenceCount: report.report.subScores.reduce(
              (total, subScore) => total + subScore.evidence.length,
              0,
            ),
            unscoredCount: report.report.unscoredRequirements.length,
            inputFlagged: report.report.inputFlagged,
            forcedLowestApplied: report.report.forcedLowestPriority.applied,
            postingFlipped,
          },
          'fit report persisted',
        );
        return reply.status(201).send(report);
      },
    );

    // Latest report or `report: null` (an empty collection, not a 404 — the
    // posting exists). Reads are never archived-gated (plan A4, the GET
    // requirements precedent). GETs never mutate (ADR-0007), no CSRF check.
    // Quote fields in the payload are posting-derived and UNTRUSTED on
    // display; no rawText key exists on this surface (drift tripwire).
    app.get(
      '/postings/:id/fit',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: postingFitResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return fit.getReport(request.user.id, request.params.id);
      },
    );

    // One-shot draft->reviewed (D8) — a POST workflow action with CAS-event
    // semantics, a NAMED deviation from ARCHITECTURE §5's PATCH row (plan
    // A2). Body is nullish: a body-less POST reaches the validator as null
    // (M1-05 lesson) and reviews with no notes. Notes never reach logs.
    app.post(
      '/fit-reports/:id/review',
      {
        schema: {
          params: idParamsSchema,
          body: fitReviewBodySchema.nullish(),
          response: {
            200: fitReviewResponseSchema,
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
        const result = await fit.review(request.user.id, request.params.id, request.body?.notes);
        request.log.info(
          { fitReportId: result.id, reviewStatus: result.reviewStatus },
          'fit report reviewed',
        );
        return result;
      },
    );

    // The report's gap set (M1-11), report-scoped exactly as ARCHITECTURE §5
    // sketches. Requirement text in the payload is posting-derived and
    // UNTRUSTED on display; rationale/notes never reach logs (they embed
    // requirement and criteria-adjacent vocabulary).
    app.get(
      '/fit-reports/:id/gaps',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: fitReportGapsResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return fit.getGaps(request.user.id, request.params.id);
      },
    );

    // The override (M1-11): PATCH exactly as ARCHITECTURE §5 sketches. FULL
    // REPLACEMENT semantics (A2, pinned in the body schema's doc-comment);
    // classification null = the D6 un-override. Log lines carry ids, the
    // bucket values, and booleans ONLY — never note or rationale text.
    app.patch(
      '/gaps/:id',
      {
        schema: {
          params: idParamsSchema,
          body: gapOverrideBodySchema,
          response: {
            200: gapOverrideResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const result = await fit.overrideGap(request.user.id, request.params.id, request.body);
        request.log.info(
          {
            gapId: result.id,
            fitReportId: result.fitReportId,
            classification: result.classification,
            engineClassification: result.engineClassification,
            userOverridden: result.userOverridden,
            hasNote: result.overrideNote !== null,
          },
          'gap classification override',
        );
        return result;
      },
    );
    done();
  };
}
