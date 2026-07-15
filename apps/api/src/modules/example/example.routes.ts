// ── Layering reference: ROUTES ──────────────────────────────────────────
// Routes only translate HTTP ⇄ service calls; no business logic and no
// persistence here. Zod schemas on params/body/response are the single
// source for validation, types, and the OpenAPI spec (M0-09, ADR-0002).

import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { errorEnvelopeSchema } from '../../schemas.ts';
import { type ExampleService } from './example.service.ts';

const exampleItemSchema = z.object({ id: z.string(), name: z.string() });

export function exampleRoutes(service: ExampleService): FastifyPluginCallbackZod {
  return (app, _opts, done) => {
    app.get(
      '/example/items',
      {
        schema: {
          response: { 200: z.array(exampleItemSchema), 401: errorEnvelopeSchema },
        },
      },
      () => service.listItems(),
    );
    app.get(
      '/example/items/:id',
      {
        schema: {
          params: z.object({ id: z.string() }),
          response: {
            200: exampleItemSchema,
            401: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
          },
        },
      },
      (request) => service.getItem(request.params.id),
    );
    done();
  };
}
