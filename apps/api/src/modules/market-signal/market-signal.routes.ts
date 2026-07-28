import { errorEnvelopeSchema, marketSignalReportSchema } from '@careerforge/core';
import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type MarketSignalService } from './market-signal.service.ts';

// M9-02 (V2-PLAN 3.5): GET /market-signal. GET (non-mutating -> the CSRF origin
// check does not apply), behind the root auth guard. Never-trust-the-client (D7):
// the ONLY input is request.user; there are NO params, query, or body - a doctored
// query/body has zero effect. Logs carry cohort + per-bucket group COUNTS ONLY -
// never requirement text, group keys, matched terms, or refs (posting-derived text
// goes to the CLIENT as data, never to logs).

export function marketSignalRoutes(services: {
  marketSignal: MarketSignalService;
}): FastifyPluginCallbackZod {
  const { marketSignal } = services;
  return (app, _opts, done) => {
    app.get(
      '/market-signal',
      {
        schema: {
          response: {
            200: marketSignalReportSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const report = await marketSignal.reportForUser(request.user.id);
        request.log.info(
          {
            groups: report.groupCount,
            instances: report.instanceCount,
            sharpen: report.buckets.sharpen.length,
            prove: report.buckets.prove.length,
            build: report.buckets.build.length,
            certify: report.buckets.certify.length,
            noAction: report.noAction.length,
            postingsWithSignal: report.cohort.postingsWithSignal,
          },
          'market signal read',
        );
        return report;
      },
    );
    done();
  };
}
