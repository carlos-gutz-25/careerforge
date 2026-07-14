import { type FastifyPluginCallback } from 'fastify';

import { UnauthorizedError } from '../auth/auth.hooks.ts';
import { ProfileParseError } from './parse-errors.ts';
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
          // Issue messages quote profile content, so they go to the response
          // body only — the log gets shape, not values (no PII in logs).
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
              message: 'profile sources failed to parse',
              issues: error.issues,
            },
          });
        }
        throw error;
      }
    });
    done();
  };
}
