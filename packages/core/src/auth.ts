import { z } from 'zod';

// Auth wire contracts (moved here from apps/api at M0-10 so apps/web types
// its client against the same definitions the routes enforce). The shapes
// are unchanged from M0-07/M0-09 — the committed OpenAPI spec's byte-compare
// drift test is the evidence this move is behavior-neutral.

export const loginBodySchema = z.object({ email: z.string(), password: z.string() });
export type LoginBody = z.infer<typeof loginBodySchema>;

/** The session user as every auth response exposes it — never more. */
export const sessionUserSchema = z.object({ id: z.string(), email: z.string() });
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const loginResponseSchema = z.object({
  user: sessionUserSchema,
  /** ISO timestamp of the session's absolute expiry. */
  expiresAt: z.string(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;
