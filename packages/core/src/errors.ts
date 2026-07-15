import { z } from 'zod';

/**
 * Canonical error envelope (ARCHITECTURE §API conventions): every non-2xx
 * body is { error: { code, message } }. apps/api route response schemas
 * reference this so the OpenAPI spec documents the exact shape the
 * centralized error handler emits, and apps/web types its error handling
 * against the same definition — one source of truth for validation, types,
 * and docs (ADR-0002; moved here from apps/api at M0-10).
 */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;
