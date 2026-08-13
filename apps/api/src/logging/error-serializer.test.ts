// M15-04 (FINDING-A): unit contract for the allow-list error serializer.
// The integration proof -- the sentinel surviving neither the response body nor
// the log record through the real app -- lives in app.test.ts.
import { describe, expect, it } from 'vitest';

import { ERROR_SERIALIZER_INTERNALS, serializeError } from './error-serializer.ts';

// Fictional throughout. No real profile data reaches this file (plan D4).
const SENTINEL = 'zzqx-fictional-param-9f3a1b';

/** Faithful double of drizzle-orm's DrizzleQueryError: values live INSIDE the
 *  message and ALSO as own enumerable properties. Matched by name in the code
 *  under test, so the name is the load-bearing part. */
class DrizzleQueryError extends Error {
  constructor(
    readonly query: string,
    readonly params: unknown[],
    cause?: unknown,
  ) {
    // String(params) is exactly what the real class's template interpolation
    // does to its array; spelled out so the lint rule can see the intent.
    super(`Failed query: ${query}\nparams: ${String(params)}`);
    if (cause) this.cause = cause;
  }
}

describe('serializeError', () => {
  it('emits ONLY allow-listed fields, dropping unknown properties entirely', () => {
    const error = Object.assign(new Error('plain failure'), {
      // The shape of the defect: a property nobody enumerated carrying data.
      secretPayload: SENTINEL,
      params: [SENTINEL],
    });

    const serialized = serializeError(error) as unknown as Record<string, unknown>;

    expect(serialized).not.toHaveProperty('secretPayload');
    expect(serialized).not.toHaveProperty('params');
    expect(JSON.stringify(serialized)).not.toContain(SENTINEL);
    // A non-embedding error keeps its message: it is the diagnostic.
    expect(serialized.message).toBe('plain failure');
    expect(serialized.type).toBe('Error');
  });

  it('suppresses message AND stack for a value-embedding error class', () => {
    const error = new DrizzleQueryError('select * from t where c = $1', [SENTINEL]);

    const serialized = serializeError(error);

    expect(serialized.type).toBe('DrizzleQueryError');
    expect(serialized.message).toBe(ERROR_SERIALIZER_INTERNALS.SUPPRESSED_MESSAGE);
    expect(JSON.stringify(serialized)).not.toContain(SENTINEL);
    expect(JSON.stringify(serialized)).not.toContain('select * from t');
    // Redacting the properties alone would NOT have been enough -- the whole
    // point is that the message carried the same payload.
    expect(serialized.stack).not.toContain(SENTINEL);
    // ...but the frames survive, or the fix would have traded a leak for a
    // blind spot.
    expect(serialized.stack).toMatch(/\n\s+at /);
  });

  it('covers unwrapped pg DatabaseError too, not just the drizzle wrapper', () => {
    const error = new Error(`invalid input syntax for type integer: "${SENTINEL}"`);
    Object.defineProperty(error.constructor, 'name', { value: 'DatabaseError' });

    // Constructed via the real matching path: name-based, extensible set.
    expect(ERROR_SERIALIZER_INTERNALS.VALUE_EMBEDDING_ERROR_NAMES.has('DatabaseError')).toBe(true);
    const serialized = serializeError(error);
    expect(serialized.message).toBe(ERROR_SERIALIZER_INTERNALS.SUPPRESSED_MESSAGE);
    expect(JSON.stringify(serialized)).not.toContain(SENTINEL);
  });

  it('admits value-free cause fields and refuses the value-bearing ones', () => {
    const error = new DrizzleQueryError('insert into t values ($1)', [SENTINEL], {
      code: '23505',
      constraint: 't_pkey',
      table: 't',
      column: 'c',
      // pg puts column VALUES in these two -- they must never be admitted.
      detail: `Key (c)=(${SENTINEL}) already exists.`,
      where: `PL/pgSQL function body near "${SENTINEL}"`,
    });

    const serialized = serializeError(error);

    expect(serialized.cause).toEqual({
      code: '23505',
      constraint: 't_pkey',
      table: 't',
      column: 'c',
    });
    expect(JSON.stringify(serialized)).not.toContain(SENTINEL);
  });

  it('keeps statusCode and code when present, and omits cause when it is empty', () => {
    const error = Object.assign(new Error('not found'), {
      statusCode: 404,
      code: 'NOT_FOUND',
    });

    const serialized = serializeError(error);

    expect(serialized.statusCode).toBe(404);
    expect(serialized.code).toBe('NOT_FOUND');
    expect(serialized).not.toHaveProperty('cause');
  });

  it('never echoes a thrown non-Error value', () => {
    const serialized = serializeError({ password: SENTINEL });

    expect(serialized.type).toBe('NonError');
    expect(JSON.stringify(serialized)).not.toContain(SENTINEL);
  });
});
