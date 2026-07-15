import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { errorEnvelopeSchema, profileResponseSchema } from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { PARSE_RULES, ProfileParseError, redactParseIssue } from './parse-errors.ts';
import { type ProfileImportService, type ProfileService } from './profile.service.ts';

const syncCountsSchema = z.object({
  inserted: z.number().int(),
  updated: z.number().int(),
  deleted: z.number().int(),
});

const importSummarySchema = z.object({
  sync: z.object({
    skills: syncCountsSchema,
    experiences: syncCountsSchema,
    projects: syncCountsSchema,
  }),
  totals: z.object({
    skills: z.number().int(),
    experiences: z.number().int(),
    projects: z.number().int(),
  }),
});

// The redacted projection ONLY (RISKS P-01): location + rule, never source
// content. The serializer enforces this shape on the wire.
const redactedIssueSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  field: z.string(),
  rule: z.enum(PARSE_RULES),
});

const parseErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(redactedIssueSchema),
  }),
});

export function profileRoutes(services: {
  importer: ProfileImportService;
  profile: ProfileService;
}): FastifyPluginCallbackZod {
  const { importer, profile } = services;
  return (app, _opts, done) => {
    // Guarded by the root auth hook (no `config.public`); reads the session
    // user's rows only. The response schema (packages/core, the same contract
    // apps/web types against) is what reaches the wire — the serializer
    // strips undeclared row fields (user_id, timestamps). No 403: GETs never
    // mutate, so the CSRF origin check doesn't run on them (ADR-0007).
    app.get(
      '/profile',
      {
        schema: {
          response: {
            200: profileResponseSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return profile.getProfile(request.user.id);
      },
    );

    // Guarded by the root auth hook (no `config.public`); imports into the
    // session user — the importer never picks a user id itself.
    app.post(
      '/profile/import',
      {
        schema: {
          response: {
            200: importSummarySchema,
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            422: parseErrorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        try {
          return await importer.importProfile(request.user.id);
        } catch (error) {
          if (error instanceof ProfileParseError) {
            // Issue messages quote profile content, so they stay off the wire
            // entirely: the response gets the redacted projection (file/line/
            // field/rule), the log gets shape only, and the raw fix-it text is
            // CLI-stderr-only (RISKS P-01).
            request.log.warn(
              {
                issueCount: error.issues.length,
                files: [...new Set(error.issues.map((issue) => issue.file))],
              },
              'profile import rejected: sources failed to parse',
            );
            return reply.status(error.statusCode).send({
              error: {
                code: error.code,
                message:
                  'profile sources failed to parse — run `pnpm profile:import` for full detail',
                issues: error.issues.map(redactParseIssue),
              },
            });
          }
          throw error;
        }
      },
    );
    done();
  };
}
