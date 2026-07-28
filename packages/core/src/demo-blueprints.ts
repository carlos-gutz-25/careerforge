import { z } from 'zod';

import { requirementCategorySchema } from './enums.ts';
import { exerciseSchema } from './exercises.ts';
import { marketSignalRefSchema } from './market-signal.ts';
import { DEMO_BLUEPRINT_TITLE_MAX_CHARS } from './demo-blueprint-scaffold.ts';

// M9-04 (V2-PLAN 3.5): wire contracts for the demo-blueprints endpoints. Core
// owns the wire; packages/core also owns the deterministic scaffolder + its
// section TYPES (demo-blueprint-scaffold.ts). All z.strictObject - a doctored
// extra field is a value-free 400 (D7). `requirementText`, `groupKey`, `title`,
// and the ids inside `refs` are posting-derived UNTRUSTED display DATA: served as
// data, escaped by the UI, never rendered as HTML/markdown. `user_id` never
// crosses the wire; timestamps are ISO strings. The four section texts carry
// template constants + derived counts ONLY - no posting-derived text is ever
// interpolated (D3), which is why requirementText rides as its own separate field.

// A Postgres text column rejects U+0000 outright - reject at the boundary for a
// value-free 400 instead of a 500 (the exercises title law). Built via
// fromCharCode(0) so no raw NUL byte and no `U+0000` escape ever enters this
// source file (source-byte law).
const NUL = String.fromCharCode(0);
const titleNoNul = (value: string) => !value.includes(NUL);

/**
 * POST /demo-blueprints body: the anchor gap id (nothing more - eligibility is
 * re-derived server-side from the live market signal, D2) and an optional title.
 * When title is omitted the server defaults it to the normalized requirement text
 * truncated to DEMO_BLUEPRINT_TITLE_MAX_CHARS; a refresh POST omitting it resets
 * to that default.
 */
export const createDemoBlueprintBodySchema = z.strictObject({
  gapId: z.uuid(),
  title: z
    .string()
    .trim()
    .min(1)
    .max(DEMO_BLUEPRINT_TITLE_MAX_CHARS)
    .refine(titleNoNul, 'must not contain U+0000')
    .optional(),
});
export type CreateDemoBlueprintBody = z.infer<typeof createDemoBlueprintBodySchema>;

/** The four scaffolded section texts (mirrors DemoBlueprintSections). */
export const demoBlueprintSectionsSchema = z.strictObject({
  problem: z.string(),
  constraints: z.string(),
  deliverables: z.string(),
  evidenceRequired: z.string(),
});
export type DemoBlueprintSectionsWire = z.infer<typeof demoBlueprintSectionsSchema>;

/** The list picker (GET /demo-blueprints): sections + heavy fields omitted. */
export const demoBlueprintListItemSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  requirementText: z.string(),
  postingCount: z.number().int().min(0),
  mustHavePostingCount: z.number().int().min(0),
  scorerVersion: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DemoBlueprintListItem = z.infer<typeof demoBlueprintListItemSchema>;

/** The full detail (GET /demo-blueprints/:id and the POST result body). Adds the
 *  snapshot counts/refs, the four sections, the honesty ceiling, and the
 *  computed read-only linked exercises (D5). `gapId` is nullable: a re-score or
 *  posting delete SET-NULLs the navigation FK while the snapshot survives (R9). */
export const demoBlueprintSchema = z.strictObject({
  id: z.string(),
  gapId: z.uuid().nullable(),
  groupKey: z.string(),
  title: z.string(),
  requirementText: z.string(),
  scorerVersion: z.number().int(),
  postingCount: z.number().int().min(0),
  instanceCount: z.number().int().min(0),
  mustHavePostingCount: z.number().int().min(0),
  niceToHavePostingCount: z.number().int().min(0),
  categories: z.array(requirementCategorySchema),
  refs: z.array(marketSignalRefSchema),
  sections: demoBlueprintSectionsSchema,
  honesty: z.string(),
  linkedExercises: z.array(exerciseSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type DemoBlueprint = z.infer<typeof demoBlueprintSchema>;

/** POST /demo-blueprints result: the affected blueprint + whether it was newly
 *  created (201) or refreshed in place (200). */
export const demoBlueprintCreateResultSchema = z.strictObject({
  demoBlueprint: demoBlueprintSchema,
  created: z.boolean(),
});
export type DemoBlueprintCreateResult = z.infer<typeof demoBlueprintCreateResultSchema>;

/** GET /demo-blueprints response envelope. */
export const demoBlueprintsResponseSchema = z.strictObject({
  demoBlueprints: z.array(demoBlueprintListItemSchema),
});
export type DemoBlueprintsResponse = z.infer<typeof demoBlueprintsResponseSchema>;
