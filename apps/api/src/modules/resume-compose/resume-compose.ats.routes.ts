import { atsCoverageReportSchema, errorEnvelopeSchema } from '@careerforge/core';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type ResumeAtsService } from './resume-ats.service.ts';

// M6-06 (ADR-0018): the ats-coverage route. GET (non-mutating -> the CSRF origin
// check does not apply), behind the root auth guard. Never-trust-the-client
// (D8a): the ONLY inputs are :id + request.user; NOTHING off the wire feeds the
// score. Logs carry the document id + the three coverage counts + the lint
// ok-boolean ONLY - never requirement text, claim text, tokens, or suggestions
// (D8b; tokens are posting-derived - they go to the CLIENT as data, never logs).
const idParamsSchema = z.object({ id: z.uuid() });

export function resumeAtsRoutes(services: {
  resumeAts: ResumeAtsService;
}): FastifyPluginCallbackZod {
  const { resumeAts } = services;
  return (app, _opts, done) => {
    // Coverage report (three separate never-merged deterministic results + the
    // honesty string). Superseded-gated (409) but DRAFT-ALLOWED - coverage is the
    // redraft loop, it runs before review (the parse-audit precedent). 404
    // not-found/not-owned, 500 malformed stored snapshot.
    app.get(
      '/resume-documents/:id/ats-coverage',
      {
        schema: {
          params: idParamsSchema,
          response: {
            200: atsCoverageReportSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // superseded
            500: errorEnvelopeSchema, // malformed stored snapshot
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const report = await resumeAts.coverageForDocument(request.user.id, request.params.id);
        request.log.info(
          {
            documentId: request.params.id,
            hit: report.requirementCoverage.counts.hit,
            partial: report.requirementCoverage.counts.partial,
            miss: report.requirementCoverage.counts.miss,
            keywordOk: report.keywordStuffing.ok,
          },
          'resume document ats-coverage scored',
        );
        return reply.send(report);
      },
    );
    done();
  };
}
