import { type FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * Marks a route as an LLM-draft POST (M10-03). In DEMO_MODE these return
     * DEMO_DISABLED (403) instead of reaching the provider: the demo is keyless
     * by decision and their outputs are pre-generated (seeded fixtures). The
     * marked-route set is a pinned gate — see the llmDraft pin test.
     */
    llmDraft?: boolean;
  }
}

/**
 * Policy refusal (403), distinct from the misconfiguration 503
 * LLM_NOT_CONFIGURED: an LLM-draft action was invoked on a keyless demo
 * instance, where those features are pre-generated rather than live.
 */
export class DemoDisabledError extends Error {
  readonly statusCode = 403;
  readonly code = 'DEMO_DISABLED';
  constructor() {
    super(
      'this action is disabled in the demo — its results are pre-generated (the demo is keyless)',
    );
  }
}

/**
 * When DEMO_MODE is on, every route marked `config: { llmDraft: true }` returns
 * DEMO_DISABLED instead of calling the provider. Registered AFTER the auth guard
 * so an unauthenticated caller still gets 401 first — a policy refusal is only
 * shown to callers who cleared authentication. When DEMO_MODE is off no hook is
 * added at all, so non-demo behavior is byte-for-byte unchanged.
 */
export function registerDemoDisabledGuard(
  app: FastifyInstance,
  options: { demoMode: boolean },
): void {
  if (!options.demoMode) return;
  app.addHook('onRequest', async (request) => {
    if (request.is404) return;
    if (request.routeOptions.config?.llmDraft === true) throw new DemoDisabledError();
  });
}
