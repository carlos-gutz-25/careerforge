import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { errorEnvelopeSchema, reviewQueueResponseSchema } from '@careerforge/core';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type ReviewQueueService } from './review-queue.service.ts';

export function reviewQueueRoutes(services: {
  reviewQueue: ReviewQueueService;
}): FastifyPluginCallbackZod {
  const { reviewQueue } = services;
  return (app, _opts, done) => {
    // The spaced review queue (M3-05): due revisits over the caller's
    // completed exercises, computed from the server clock on every GET —
    // nothing is stored, so there is nothing to go stale. GETs never mutate
    // (ADR-0007), no CSRF check. Exercise titles are user-authored and
    // UNTRUSTED on display (S-02). Log lines carry counts ONLY — never
    // titles.
    app.get(
      '/review-queue',
      {
        schema: {
          response: {
            200: reviewQueueResponseSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const queue = await reviewQueue.getQueue(request.user.id);
        request.log.info({ dueCount: queue.items.length }, 'review queue read');
        return queue;
      },
    );

    done();
  };
}
