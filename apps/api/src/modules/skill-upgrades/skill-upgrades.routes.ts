import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  createSkillUpgradeBodySchema,
  errorEnvelopeSchema,
  revokeSkillUpgradeBodySchema,
  skillUpgradeResponseSchema,
  skillUpgradeSuggestionsResponseSchema,
  skillUpgradesResponseSchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { type SkillUpgradesService } from './skill-upgrades.service.ts';

// Same uuid boundary as every module: malformed ids are a value-free 400.
const idParamsSchema = z.object({ id: z.uuid() });

export function skillUpgradesRoutes(services: {
  skillUpgrades: SkillUpgradesService;
}): FastifyPluginCallbackZod {
  const { skillUpgrades } = services;
  return (app, _opts, done) => {
    // Deterministically-derived upgrade suggestions (M3-06): completed,
    // fully-evidenced exercises whose evidence would earn a suggestible skill a
    // `solid` grant. Recomputed on every GET — nothing stored, nothing stale
    // (the review-queue projection pattern). GETs never mutate (ADR-0007), no
    // CSRF. Requirement text is user/posting-derived and UNTRUSTED on display
    // (S-02); log lines carry counts ONLY.
    app.get(
      '/skill-upgrade-suggestions',
      {
        schema: {
          response: {
            200: skillUpgradeSuggestionsResponseSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const result = await skillUpgrades.listSuggestions(request.user.id);
        request.log.info(
          { suggestionCount: result.suggestions.length },
          'skill-upgrade suggestions read',
        );
        return result;
      },
    );

    // Confirm an earned upgrade (M3-06). Guarded by the root auth hook; CSRF
    // origin check applies. The server re-derives the suggestion from the
    // exercise + profile state (zero client trust): 404 skill/exercise, 409 not
    // derivable / already active. Log lines carry ids + levels ONLY.
    app.post(
      '/skill-upgrades',
      {
        schema: {
          body: createSkillUpgradeBodySchema,
          response: {
            201: skillUpgradeResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema, // skill or exercise not found
            409: errorEnvelopeSchema, // not derivable, or already active
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const grant = await skillUpgrades.create(request.user.id, request.body);
        request.log.info(
          { upgradeId: grant.id, fromLevel: grant.fromLevel, toLevel: grant.toLevel },
          'skill upgrade granted',
        );
        return reply.status(201).send(grant);
      },
    );

    // The audit view: all grants (active + revoked) with their evidence trail
    // and the derived detached flag. Read-only, no CSRF.
    app.get(
      '/skill-upgrades',
      {
        schema: {
          response: {
            200: skillUpgradesResponseSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const result = await skillUpgrades.listGrants(request.user.id);
        request.log.info({ upgradeCount: result.upgrades.length }, 'skill upgrades read');
        return result;
      },
    );

    // Revoke an active grant (the correction recourse; effective falls back to
    // declared). Never a delete — append-only history. 404 unknown/foreign, 409
    // already revoked. Log lines carry the id ONLY (never the note — UNTRUSTED).
    app.post(
      '/skill-upgrades/:id/revoke',
      {
        schema: {
          params: idParamsSchema,
          body: revokeSkillUpgradeBodySchema,
          response: {
            200: skillUpgradeResponseSchema,
            400: errorEnvelopeSchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            404: errorEnvelopeSchema,
            409: errorEnvelopeSchema, // already revoked
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        const grant = await skillUpgrades.revoke(request.user.id, request.params.id, request.body);
        request.log.info({ upgradeId: grant.id }, 'skill upgrade revoked');
        return grant;
      },
    );

    done();
  };
}
