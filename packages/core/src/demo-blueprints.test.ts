import { describe, expect, it } from 'vitest';

import {
  createDemoBlueprintBodySchema,
  demoBlueprintSchema,
  demoBlueprintsResponseSchema,
} from './demo-blueprints.ts';
import { scaffoldDemoBlueprint } from './demo-blueprint-scaffold.ts';

// M9-04: wire-contract pins (D7). strictObject rejects doctored fields; the
// title law bounds + rejects U+0000; the assembled detail parses against
// demoBlueprintSchema (schema-engine compatibility for the route).

const NUL = String.fromCharCode(0);
// Valid v4-shaped UUIDs (z.uuid() checks the version + variant nibbles).
const GAP_ID = '22222222-2222-4222-8222-222222222222';

function validDetail() {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    gapId: GAP_ID,
    groupKey: 'kubernetes operators',
    title: 'Kubernetes operators',
    requirementText: 'Experience building Kubernetes operators',
    scorerVersion: 1,
    postingCount: 3,
    instanceCount: 5,
    mustHavePostingCount: 2,
    niceToHavePostingCount: 1,
    categories: ['framework'],
    refs: [
      {
        gapId: '22222222-2222-4222-8222-222222222222',
        postingId: '33333333-3333-3333-3333-333333333333',
        fitReportId: '44444444-4444-4444-4444-444444444444',
        classification: 'genuine_gap',
      },
    ],
    sections: scaffoldDemoBlueprint({
      postingCount: 3,
      instanceCount: 5,
      mustHavePostingCount: 2,
      niceToHavePostingCount: 1,
      categories: ['framework'],
    }),
    honesty: 'ceiling',
    linkedExercises: [],
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
  };
}

describe('createDemoBlueprintBodySchema (M9-04, D7)', () => {
  it('accepts a bare gapId and an optional title', () => {
    const gapId = '22222222-2222-4222-8222-222222222222';
    expect(createDemoBlueprintBodySchema.parse({ gapId })).toEqual({ gapId });
    expect(createDemoBlueprintBodySchema.parse({ gapId, title: 'My build' }).title).toBe(
      'My build',
    );
  });

  it('rejects a non-uuid gapId, a doctored extra field, and a U+0000 title', () => {
    expect(createDemoBlueprintBodySchema.safeParse({ gapId: 'not-a-uuid' }).success).toBe(false);
    expect(
      createDemoBlueprintBodySchema.safeParse({
        gapId: '22222222-2222-4222-8222-222222222222',
        rogue: 1,
      }).success,
    ).toBe(false);
    expect(
      createDemoBlueprintBodySchema.safeParse({
        gapId: '22222222-2222-4222-8222-222222222222',
        title: `bad${NUL}title`,
      }).success,
    ).toBe(false);
  });
});

describe('demoBlueprintSchema (M9-04, D7)', () => {
  it('parses an assembled detail (schema-engine compatibility)', () => {
    expect(demoBlueprintSchema.parse(validDetail())).toBeTruthy();
  });

  it('allows a null gapId (SET-NULL survivor) but rejects unknown keys', () => {
    expect(demoBlueprintSchema.parse({ ...validDetail(), gapId: null }).gapId).toBeNull();
    expect(demoBlueprintSchema.safeParse({ ...validDetail(), rogue: true }).success).toBe(false);
  });

  it('list response envelope validates', () => {
    expect(
      demoBlueprintsResponseSchema.parse({
        demoBlueprints: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            title: 'Kubernetes operators',
            requirementText: 'Experience building Kubernetes operators',
            postingCount: 3,
            mustHavePostingCount: 2,
            scorerVersion: 1,
            createdAt: '2026-07-28T00:00:00.000Z',
            updatedAt: '2026-07-28T00:00:00.000Z',
          },
        ],
      }).demoBlueprints,
    ).toHaveLength(1);
  });
});
