import { z } from 'zod';

/**
 * Canonical error envelope (ARCHITECTURE §API conventions): every non-2xx
 * body is { error: { code, message } }. Route response schemas reference this
 * so the OpenAPI spec documents the exact shape the centralized error handler
 * emits — one source of truth for validation, types, and docs (ADR-0002).
 */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
