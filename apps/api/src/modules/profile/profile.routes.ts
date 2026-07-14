import { type FastifyPluginCallback } from 'fastify';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { ProfileParseError, redactParseIssue } from './parse-errors.ts';
import { type ProfileImportService } from './profile.service.ts';

export function profileRoutes(service: ProfileImportService): FastifyPluginCallback {
  return (app, _opts, done) => {
    // Guarded by the root auth hook (no `config.public`); imports into the
    // session user — the importer never picks a user id itself.
    app.post('/profile/import', async (request, reply) => {
      if (!request.user) throw new UnauthorizedError();
      try {
        return await service.importProfile(request.user.id);
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
    });
    done();
  };
}
