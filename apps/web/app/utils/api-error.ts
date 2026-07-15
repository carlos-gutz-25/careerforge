import type { ErrorEnvelope } from '@careerforge/core';

/**
 * Every non-2xx API response carries the canonical envelope
 * `{ error: { code, message } }` (packages/core); the client rethrows it as
 * this typed error so pages can branch on `status`/`code` without touching
 * ofetch internals.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function toApiError(status: number, body: unknown): ApiError {
  const envelope = body as Partial<ErrorEnvelope> | null | undefined;
  return new ApiError(
    status,
    envelope?.error?.code ?? 'UNKNOWN',
    envelope?.error?.message ?? `request failed with status ${status}`,
  );
}
