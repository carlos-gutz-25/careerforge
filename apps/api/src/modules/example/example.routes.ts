// ── Layering reference: ROUTES ──────────────────────────────────────────
// Routes only translate HTTP ⇄ service calls; no business logic and no
// persistence here. Zod schemas on params/body/response (and the OpenAPI
// generated from them) arrive with M0-09.

import { type FastifyPluginCallback } from 'fastify';

import { type ExampleService } from './example.service.ts';

export function exampleRoutes(service: ExampleService): FastifyPluginCallback {
  return (app, _opts, done) => {
    app.get('/example/items', () => service.listItems());
    app.get<{ Params: { id: string } }>('/example/items/:id', (request) =>
      service.getItem(request.params.id),
    );
    done();
  };
}
