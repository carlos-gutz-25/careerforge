import { describe, expect, it } from 'vitest';

import { evaluatePreRegistration, scanForbidden } from './evaluate-primitives.ts';

describe('evaluatePreRegistration', () => {
  const fixture = { liveExpectation: { acceptableStatuses: ['ok', 'schema_failed'] as const } };

  it('is within pre-registration for an accepted status, with no reason', () => {
    expect(evaluatePreRegistration(fixture, 'ok')).toEqual({ withinPreRegistration: true });
    expect(evaluatePreRegistration(fixture, 'schema_failed')).toEqual({
      withinPreRegistration: true,
    });
  });

  it('is outside pre-registration for an unaccepted status, with the verbatim reason', () => {
    expect(evaluatePreRegistration(fixture, 'refusal')).toEqual({
      withinPreRegistration: false,
      reason: "status 'refusal' is outside pre-registration (classify and record)",
    });
  });

  it('never leaks a status value beyond interpolating it into the fixed reason', () => {
    const { reason } = evaluatePreRegistration(fixture, 'max_tokens');
    expect(reason).toBe("status 'max_tokens' is outside pre-registration (classify and record)");
  });
});

describe('scanForbidden', () => {
  it('is true when any marker is a substring of any emitted string', () => {
    expect(scanForbidden(['CANARY'], ['a clean line', 'holds a CANARY inside'])).toBe(true);
  });

  it('is false when no marker appears', () => {
    expect(scanForbidden(['CANARY'], ['clean', 'also clean'])).toBe(false);
  });

  it('is case-sensitive (matches the live loop exactly)', () => {
    expect(scanForbidden(['CANARY'], ['lowercase canary'])).toBe(false);
  });

  it('is false for empty markers or empty emitted strings (no vacuous hit)', () => {
    expect(scanForbidden([], ['CANARY'])).toBe(false);
    expect(scanForbidden(['CANARY'], [])).toBe(false);
  });

  it('matches on the first of several markers', () => {
    expect(scanForbidden(['ONE', 'TWO'], ['contains TWO'])).toBe(true);
  });
});
