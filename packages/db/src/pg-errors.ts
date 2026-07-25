/**
 * drizzle >=0.44 wraps driver errors (DrizzleQueryError); walk `.cause` for the
 * underlying pg error code (e.g. '23505' unique_violation, '23514' check_
 * violation). Shared by the integration test-utils and the service layer's
 * backstop mappings (e.g. a raced duplicate active grant -> 409, M3-06).
 */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') return code;
  return pgErrorCode((error as { cause?: unknown }).cause);
}
