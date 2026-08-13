/**
 * M15-04 (FINDING-A): the log-leg fix.
 *
 * pino's stock error serializer copies EVERY enumerable own property off an
 * Error onto the log record. `DrizzleQueryError` (drizzle-orm) is built as
 * `super("Failed query: " + query + "\nparams: " + params)` and ALSO keeps
 * `.query` / `.params` as own properties, so a single `log.error({ err })`
 * emits the SQL and every bound parameter twice over -- once inside the
 * message, once as fields. On the public demo that sink is CloudWatch.
 *
 * The defence is an ALLOW-list, not a blocklist. Blocklisting the fields we
 * happen to know about (`delete err.params`) leaves the next library that hangs
 * data off an Error unsafe by default, and the whole defect is that a property
 * nobody enumerated carried the payload.
 */

/** The only Error fields that may reach the log sink. */
const ALLOWED_ERROR_FIELDS = ['type', 'message', 'stack', 'statusCode', 'code'] as const;

/**
 * Value-free diagnostic fields admitted from `error.cause` -- the SQLSTATE and
 * the constraint/table/column names, which are the first things anyone wants
 * when reading a DB failure and which carry no row data.
 *
 * NOTHING else is admitted from `cause`. In particular NOT `detail`, NOT
 * `where`, NOT `message`: node-postgres embeds column VALUES in those
 * ("Key (email)=(someone@example.com) already exists" is the canonical case).
 */
const ALLOWED_CAUSE_FIELDS = ['code', 'constraint', 'table', 'column'] as const;

/**
 * Error classes that interpolate query text and bound parameters INTO
 * `.message`, and therefore into `.stack` as well. For these, redacting the
 * properties is not enough and redacting the message is not enough -- both go.
 *
 * Matched by constructor NAME on purpose: this module must not import
 * drizzle-orm or pg (module wall, and it would drag a driver into the logging
 * path). ADD NEW EMBEDDING ERROR CLASSES HERE as they are discovered.
 *
 * - `DrizzleQueryError` -- drizzle wraps query failures.
 * - `DatabaseError` -- the raw node-postgres error, which still reaches the
 *   handler unwrapped on pool and connection paths, and whose messages embed
 *   values ('invalid input syntax for type integer: "abc"').
 */
const VALUE_EMBEDDING_ERROR_NAMES: ReadonlySet<string> = new Set([
  'DrizzleQueryError',
  'DatabaseError',
]);

/** Replaces any message/stack header that may carry embedded query values. */
const SUPPRESSED_MESSAGE = 'database query failed (details suppressed)';

/**
 * `stack` is a required string, not `string | undefined`: Fastify's logger
 * option types the `err` serializer's return as pino's SerializedError shape,
 * where stack is always present. An optional stack fails that overload and --
 * because the failure sends TS to the LAST overload -- silently retypes the
 * whole app instance as Http2. Empty string is the "no frames" value.
 */
export interface SerializedError {
  /** Required by Fastify's serializer contract. This is a TYPE-level widening
   *  only: the object this module builds carries the allow-listed keys and
   *  nothing else, which is what the tests assert. */
  [key: string]: unknown;
  type: string;
  message: string;
  stack: string;
  statusCode?: number;
  code?: string;
  cause?: Record<string, string>;
}

/**
 * Keeps the frames, replaces the header. A stack's leading line(s) are the
 * error's message, so for an embedding class the header is exactly the thing
 * that must not ship -- but the frames are what make the failure diagnosable.
 */
function sanitizeStack(stack: string | undefined, type: string): string {
  const header = `${type}: ${SUPPRESSED_MESSAGE}`;
  if (stack === undefined) return header;
  const firstFrame = stack.search(/^\s+at /m);
  return firstFrame === -1 ? header : `${header}\n${stack.slice(firstFrame)}`;
}

/** Named fields in, everything else out. */
function serializeCause(cause: unknown): Record<string, string> | undefined {
  if (typeof cause !== 'object' || cause === null) return undefined;
  const source = cause as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const field of ALLOWED_CAUSE_FIELDS) {
    const value = source[field];
    if (typeof value === 'string' || typeof value === 'number') {
      out[field] = String(value);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * pino `err` serializer. Emits ALLOWED_ERROR_FIELDS and nothing else; for a
 * value-embedding error class the message and stack header are replaced too.
 */
export function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) {
    // Defensive: the error handler narrows to Error before logging, so this is
    // unreachable from the route path. Emit no value -- a thrown non-Error is
    // exactly as likely to be a credential-bearing object as anything else.
    return { type: 'NonError', message: 'non-Error value thrown (details suppressed)', stack: '' };
  }

  const type = error.constructor?.name ?? 'Error';
  const embedsValues = VALUE_EMBEDDING_ERROR_NAMES.has(type);
  const source = error as Error & Record<string, unknown>;

  const serialized: SerializedError = {
    type,
    message: embedsValues ? SUPPRESSED_MESSAGE : error.message,
    stack: embedsValues ? sanitizeStack(error.stack, type) : (error.stack ?? ''),
  };

  if (typeof source.statusCode === 'number') serialized.statusCode = source.statusCode;
  if (typeof source.code === 'string') serialized.code = source.code;

  const cause = serializeCause(error.cause);
  if (cause !== undefined) serialized.cause = cause;

  return serialized;
}

/**
 * True when the error's class interpolates query text or bound parameters into
 * its own message. The centralized error handler uses this as a second gate
 * before letting ANY 5xx message reach the client: an error of one of these
 * classes is suppressed even if it somehow also declares the status+code
 * contract, because its message is unsafe by construction rather than by
 * intent.
 */
export function embedsQueryValues(error: unknown): boolean {
  return error instanceof Error && VALUE_EMBEDDING_ERROR_NAMES.has(error.constructor?.name ?? '');
}

/** Exported for the tests that prove the allow-list is closed. */
export const ERROR_SERIALIZER_INTERNALS = {
  ALLOWED_ERROR_FIELDS,
  ALLOWED_CAUSE_FIELDS,
  VALUE_EMBEDDING_ERROR_NAMES,
  SUPPRESSED_MESSAGE,
} as const;
