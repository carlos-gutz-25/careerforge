import { z } from 'zod';

import { evidenceKindSchema } from './enums.ts';

// Wire contracts for POST /mastery-evidence and DELETE /mastery-evidence/:id
// (M3-03). A mastery-evidence row is a USER-AUTHORED record that an exercise
// (M3-02) was actually done — deterministic CRUD, NOT LLM-drafted (no run
// table, no citation tripwire). It is IMMUTABLE once written: no PATCH (a
// mis-created record is recovered with DELETE, not an edit). `artifactUrl` is
// user-authored UNTRUSTED text: escaped on display, NUL-rejected at the
// boundary. `user_id` never crosses the wire.

/** Length bound on the optional user-authored `artifactUrl` (repo / test-run /
 *  writeup link). Generous for real URLs; paired with a NUL-reject below.
 *  There is no literal bound in the shipped column (text). */
export const EVIDENCE_ARTIFACT_URL_MAX_CHARS = 2048;

// A Postgres text column rejects U+0000 outright — reject at the boundary for a
// value-free 400 instead of a 500 (the exercises.title / postings.rawText
// precedent). The guard uses the escaped U+0000 code unit, never a raw NUL
// byte (source-byte law).
const urlNoNul = (value: string) => !value.includes('\u0000');

/**
 * POST /mastery-evidence — record one piece of evidence that an exercise was
 * done, under an exercise the caller owns (a 404 ownership precondition runs in
 * the service before any write). `artifactUrl` is optional/nullable: an
 * `explained` record (whiteboard, verbal) may carry no link; the substantive
 * record is kind + date. `recordedOn` is FORMAT-validated here only (an ISO
 * `YYYY-MM-DD` date); the service applies the default (server today) and the
 * reject-future rule, which need the server clock and so cannot live in this
 * clock-free schema.
 */
export const createMasteryEvidenceBodySchema = z.strictObject({
  exerciseId: z.uuid(),
  kind: evidenceKindSchema,
  artifactUrl: z
    .string()
    .trim()
    .min(1)
    .max(EVIDENCE_ARTIFACT_URL_MAX_CHARS)
    .refine(urlNoNul, 'must not contain U+0000')
    .nullish(),
  recordedOn: z.iso.date().optional(),
});
export type CreateMasteryEvidenceBody = z.infer<typeof createMasteryEvidenceBodySchema>;

/**
 * One mastery-evidence record on the wire. `artifactUrl` is null when the
 * record carries no link; `recordedOn` is the ISO `YYYY-MM-DD` date the work
 * happened (defaulted to the creation day when the client omits it), distinct
 * from `createdAt` which is the insert instant. The shape returned by POST and
 * embedded on each exercise in GET /learning-plans/:id (M3-03 D4).
 */
export const masteryEvidenceSchema = z.strictObject({
  id: z.string(),
  exerciseId: z.string(),
  kind: evidenceKindSchema,
  artifactUrl: z.string().nullable(),
  recordedOn: z.iso.date(),
  createdAt: z.iso.datetime(),
});
export type MasteryEvidence = z.infer<typeof masteryEvidenceSchema>;

/** POST /mastery-evidence (201) returns the one created record — the row
 *  contract shared with the learning-plan exercise embed. */
export const masteryEvidenceResponseSchema = masteryEvidenceSchema;
export type MasteryEvidenceResponse = z.infer<typeof masteryEvidenceResponseSchema>;
