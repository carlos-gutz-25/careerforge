import { type FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import {
  errorEnvelopeSchema,
  profileFactsResponseSchema,
  profileWithDeclaredResponseSchema,
} from '@careerforge/core';
import { z } from 'zod';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { PARSE_RULES, ProfileParseError, redactParseIssue } from './parse-errors.ts';
import {
  ImportConfirmationError,
  SnapshotUnavailableError,
  type ProfileImportService,
  type ProfileService,
} from './profile.service.ts';

const syncCountsSchema = z.object({
  inserted: z.number().int(),
  updated: z.number().int(),
  deleted: z.number().int(),
});

const importSummarySchema = z.object({
  // M6-01 adds contact/summaries/education; bullets stays off the wire
  // (M2-12 export-only — a deliberate omission, not a new one).
  sync: z.object({
    skills: syncCountsSchema,
    experiences: syncCountsSchema,
    projects: syncCountsSchema,
    contact: syncCountsSchema,
    summaries: syncCountsSchema,
    education: syncCountsSchema,
  }),
  // M12-03: the facts.md full-sync deltas (values never on the wire, only counts).
  facts: syncCountsSchema,
  totals: z.object({
    skills: z.number().int(),
    experiences: z.number().int(),
    projects: z.number().int(),
    contact: z.number().int(),
    summaries: z.number().int(),
    education: z.number().int(),
  }),
  // `replaced` is DELIBERATELY unrepresentable here: overwriting a differing
  // criteria row takes the CLI's --force (M1-08 collision rule) — this route
  // never forces, and the serializer failing loudly on `replaced` is the pin.
  criteria: z.object({
    outcome: z.enum(['created', 'unchanged', 'skipped_existing']),
  }),
});

// M13-09 (F-7): the preview shape - the same wire deltas as the summary (bullets
// stay off, M2-12), MINUS criteria, PLUS the destructive flag and the CAS
// fingerprint (a value-free hash - safe on the wire, RISKS P-01).
const importPreviewResponseSchema = importSummarySchema
  .omit({ criteria: true })
  .extend({ destructive: z.boolean(), fingerprint: z.string() });

// The request body (all optional, back-compat: a no-body POST is a plain import).
// `.nullish()` at the route lets a missing body through (the plans/fit precedent).
//   { preview: true }             -> 200 preview + fingerprint, writes nothing
//   { confirmDeletes: '<fp>' }    -> authorizes a destructive import (CAS-checked)
const importRequestBodySchema = z.strictObject({
  preview: z.literal(true).optional(),
  confirmDeletes: z.string().optional(),
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
            // M3-06 (OD-7): skills carry effective `level` + raw `declaredLevel`
            // (the getProfile overlay). The serializer keeps both; scoring reads
            // effective only through the unchanged profileResponseSchema.
            200: profileWithDeclaredResponseSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return profile.getProfile(request.user.id);
      },
    );

    // M12-03: the session user's declared durable facts (Evidence Library). Read
    // only in v2.1 — facts.md is the source of truth (D-4). Same auth posture as
    // GET /profile: session-scoped, no CSRF on a GET, response schema strips
    // undeclared fields. Values are escaped ({{ }}, no v-html) by the client.
    app.get(
      '/profile/facts',
      {
        schema: {
          response: {
            200: profileFactsResponseSchema,
            401: errorEnvelopeSchema,
          },
        },
      },
      async (request) => {
        if (!request.user) throw new UnauthorizedError();
        return { facts: await profile.listFacts(request.user.id) };
      },
    );

    // Guarded by the root auth hook (no `config.public`); imports into the
    // session user — the importer never picks a user id itself.
    app.post(
      '/profile/import',
      {
        schema: {
          // Optional body (nullish): a no-body POST stays a plain import.
          body: importRequestBodySchema.nullish(),
          response: {
            // 200 carries EITHER the import summary OR a preview (disjoint on
            // criteria vs fingerprint, so the union resolves unambiguously).
            200: z.union([importSummarySchema, importPreviewResponseSchema]),
            401: errorEnvelopeSchema,
            403: errorEnvelopeSchema,
            // M13-09: a destructive import that is unconfirmed, stale, or cannot
            // be snapshotted (the confirm gate + the D4 snapshot posture).
            409: errorEnvelopeSchema,
            422: parseErrorEnvelopeSchema,
          },
        },
      },
      async (request, reply) => {
        if (!request.user) throw new UnauthorizedError();
        const body: { preview?: true; confirmDeletes?: string } = request.body ?? {};
        try {
          // Preview mode (M13-09): the would-be deltas + fingerprint, no writes.
          if (body.preview === true) {
            return await importer.previewImport(request.user.id);
          }
          // Guarded import. The route NEVER forces criteria (M1-08 `replaced`
          // stays CLI-only) and NEVER skips the snapshot (D4: --no-snapshot is
          // CLI-only - a destructive HTTP import is directed to the CLI when it
          // cannot snapshot). Destructiveness + the confirm CAS + the snapshot
          // are all decided ONCE in the service (D2).
          const summary = await importer.importGuarded(request.user.id, {
            confirmDeletes: body.confirmDeletes,
          });
          if (summary.criteria.outcome === 'replaced') {
            // Unreachable: this route never passes forceCriteria. The guard
            // keeps `replaced` unrepresentable in the wire contract at the
            // TYPE level too — a future code path that forces over HTTP
            // fails compilation here, not silently in the serializer.
            throw new Error('criteria import reported `replaced` on the force-less HTTP path');
          }
          return {
            sync: summary.sync,
            facts: summary.facts,
            totals: summary.totals,
            criteria: { outcome: summary.criteria.outcome },
          };
        } catch (error) {
          if (
            error instanceof ImportConfirmationError ||
            error instanceof SnapshotUnavailableError
          ) {
            // 409-class: destructive import not authorized (unconfirmed / stale
            // fingerprint / unsnapshottable). The envelope is code + message
            // only - never counts, fingerprints, or profile content on this path.
            request.log.warn(
              {
                code: error.code,
                reason:
                  error instanceof ImportConfirmationError ? error.reason : 'snapshot_unavailable',
              },
              'profile import refused: destructive import not authorized',
            );
            return reply.status(409).send({
              error: { code: error.code, message: error.message },
            });
          }
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
