import { describe, expect, it } from 'vitest';

import {
  CREATE_EXERCISE_MAX_GAPS,
  createExerciseBodySchema,
  EXERCISE_TITLE_MAX_CHARS,
  exercisePatchBodySchema,
} from './exercises.ts';

const A_UUID = '11111111-1111-4111-8111-111111111111';
const B_UUID = '22222222-2222-4222-8222-222222222222';

// A NUL built at runtime — the source itself stays printable-ASCII (no raw
// byte, no escape) so the guard is exercised without tripping the source-byte
// law.
const NUL = String.fromCharCode(0);

describe('createExerciseBodySchema (M3-02 POST /exercises)', () => {
  const valid = {
    learningPlanId: A_UUID,
    title: 'Rebuild the auth flow as a kata',
    kind: 'kata' as const,
    gapIds: [A_UUID, B_UUID],
  };

  it('accepts a well-formed body', () => {
    expect(createExerciseBodySchema.parse(valid)).toEqual(valid);
  });

  it('trims the title and requires it non-empty', () => {
    expect(createExerciseBodySchema.parse({ ...valid, title: '  spaced  ' }).title).toBe('spaced');
    expect(createExerciseBodySchema.safeParse({ ...valid, title: '   ' }).success).toBe(false);
    expect(createExerciseBodySchema.safeParse({ ...valid, title: '' }).success).toBe(false);
  });

  it('bounds the title at EXERCISE_TITLE_MAX_CHARS', () => {
    expect(EXERCISE_TITLE_MAX_CHARS).toBe(200);
    expect(
      createExerciseBodySchema.safeParse({ ...valid, title: 'x'.repeat(EXERCISE_TITLE_MAX_CHARS) })
        .success,
    ).toBe(true);
    expect(
      createExerciseBodySchema.safeParse({
        ...valid,
        title: 'x'.repeat(EXERCISE_TITLE_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
  });

  it('rejects a title containing U+0000 (value-free 400, not a 500)', () => {
    expect(createExerciseBodySchema.safeParse({ ...valid, title: `bad${NUL}title` }).success).toBe(
      false,
    );
  });

  it('requires at least one gap and caps at CREATE_EXERCISE_MAX_GAPS', () => {
    expect(CREATE_EXERCISE_MAX_GAPS).toBe(50);
    expect(createExerciseBodySchema.safeParse({ ...valid, gapIds: [] }).success).toBe(false);
    const tooMany = Array.from({ length: CREATE_EXERCISE_MAX_GAPS + 1 }, () => A_UUID);
    expect(createExerciseBodySchema.safeParse({ ...valid, gapIds: tooMany }).success).toBe(false);
  });

  it('requires gapIds and learningPlanId to be uuids', () => {
    expect(createExerciseBodySchema.safeParse({ ...valid, gapIds: ['not-a-uuid'] }).success).toBe(
      false,
    );
    expect(createExerciseBodySchema.safeParse({ ...valid, learningPlanId: 'nope' }).success).toBe(
      false,
    );
  });

  it('rejects an invalid kind', () => {
    expect(createExerciseBodySchema.safeParse({ ...valid, kind: 'quiz' }).success).toBe(false);
  });

  it('rejects unknown keys (strictObject) — no client-supplied position or status', () => {
    expect(createExerciseBodySchema.safeParse({ ...valid, position: 3 }).success).toBe(false);
    expect(createExerciseBodySchema.safeParse({ ...valid, status: 'complete' }).success).toBe(
      false,
    );
  });
});

describe('exercisePatchBodySchema (M3-02 PATCH /exercises/:id)', () => {
  it('accepts a status transition and only a status', () => {
    expect(exercisePatchBodySchema.parse({ status: 'in_progress' })).toEqual({
      status: 'in_progress',
    });
  });

  it('rejects a non-member status and `dropped` (exercises have no dropped)', () => {
    expect(exercisePatchBodySchema.safeParse({ status: 'done' }).success).toBe(false);
    expect(exercisePatchBodySchema.safeParse({ status: 'dropped' }).success).toBe(false);
  });

  it('rejects editing anything but status (title/kind immutable via PATCH)', () => {
    expect(exercisePatchBodySchema.safeParse({ status: 'complete', title: 'x' }).success).toBe(
      false,
    );
    expect(exercisePatchBodySchema.safeParse({}).success).toBe(false);
  });
});
