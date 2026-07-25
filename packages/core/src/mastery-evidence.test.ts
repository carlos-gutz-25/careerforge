import { describe, expect, it } from 'vitest';

import {
  createMasteryEvidenceBodySchema,
  EVIDENCE_ARTIFACT_URL_MAX_CHARS,
} from './mastery-evidence.ts';

const EXERCISE_UUID = '11111111-1111-4111-8111-111111111111';

// A NUL built at runtime — the source itself stays printable-ASCII (no raw
// byte, no escape) so the guard is exercised without tripping the source-byte
// law.
const NUL = String.fromCharCode(0);

describe('createMasteryEvidenceBodySchema (M3-03 POST /mastery-evidence)', () => {
  const valid = {
    exerciseId: EXERCISE_UUID,
    kind: 'implemented' as const,
    artifactUrl: 'https://github.com/alex/repo/pull/7',
    recordedOn: '2026-07-20',
  };

  it('accepts a well-formed body', () => {
    expect(createMasteryEvidenceBodySchema.parse(valid)).toEqual(valid);
  });

  it('accepts an omitted artifactUrl and recordedOn (both optional)', () => {
    const parsed = createMasteryEvidenceBodySchema.parse({
      exerciseId: EXERCISE_UUID,
      kind: 'explained',
    });
    expect(parsed).toEqual({ exerciseId: EXERCISE_UUID, kind: 'explained' });
  });

  it('accepts an explicit null artifactUrl (no link on this record)', () => {
    expect(createMasteryEvidenceBodySchema.safeParse({ ...valid, artifactUrl: null }).success).toBe(
      true,
    );
  });

  it('trims the artifactUrl and requires it non-empty when present', () => {
    expect(
      createMasteryEvidenceBodySchema.parse({ ...valid, artifactUrl: '  https://x.test  ' })
        .artifactUrl,
    ).toBe('https://x.test');
    expect(
      createMasteryEvidenceBodySchema.safeParse({ ...valid, artifactUrl: '   ' }).success,
    ).toBe(false);
  });

  it('bounds the artifactUrl at EVIDENCE_ARTIFACT_URL_MAX_CHARS', () => {
    expect(EVIDENCE_ARTIFACT_URL_MAX_CHARS).toBe(2048);
    const max = `https://x.test/${'a'.repeat(EVIDENCE_ARTIFACT_URL_MAX_CHARS - 15)}`;
    expect(max.length).toBe(EVIDENCE_ARTIFACT_URL_MAX_CHARS);
    expect(createMasteryEvidenceBodySchema.safeParse({ ...valid, artifactUrl: max }).success).toBe(
      true,
    );
    expect(
      createMasteryEvidenceBodySchema.safeParse({ ...valid, artifactUrl: `${max}a` }).success,
    ).toBe(false);
  });

  it('rejects an artifactUrl containing U+0000 (value-free 400, not a 500)', () => {
    expect(
      createMasteryEvidenceBodySchema.safeParse({ ...valid, artifactUrl: `bad${NUL}url` }).success,
    ).toBe(false);
  });

  it('rejects an invalid kind', () => {
    expect(createMasteryEvidenceBodySchema.safeParse({ ...valid, kind: 'read' }).success).toBe(
      false,
    );
  });

  it('requires exerciseId to be a uuid', () => {
    expect(
      createMasteryEvidenceBodySchema.safeParse({ ...valid, exerciseId: 'nope' }).success,
    ).toBe(false);
  });

  it('validates recordedOn FORMAT only (an ISO YYYY-MM-DD date)', () => {
    // The clock-dependent rules — default-to-today and reject-future — live in
    // the service, not this clock-free schema. Here we only pin the format.
    expect(
      createMasteryEvidenceBodySchema.safeParse({ ...valid, recordedOn: '07/20/2026' }).success,
    ).toBe(false);
    expect(
      createMasteryEvidenceBodySchema.safeParse({ ...valid, recordedOn: '2026-07-20T00:00:00Z' })
        .success,
    ).toBe(false);
    // A future-dated but well-FORMED value parses here; the service rejects it.
    expect(
      createMasteryEvidenceBodySchema.safeParse({ ...valid, recordedOn: '2999-01-01' }).success,
    ).toBe(true);
  });

  it('rejects unknown keys (strictObject) — no client-supplied user_id or id', () => {
    expect(
      createMasteryEvidenceBodySchema.safeParse({ ...valid, userId: EXERCISE_UUID }).success,
    ).toBe(false);
    expect(createMasteryEvidenceBodySchema.safeParse({ ...valid, id: EXERCISE_UUID }).success).toBe(
      false,
    );
  });
});
