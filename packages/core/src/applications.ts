import { z } from 'zod';

import { applicationEventKindSchema, applicationStageSchema } from './enums.ts';

// Wire contracts for /applications (M1-03). Ownership contrast with postings
// (M1-02): ALL application stages are user-driven — no pipeline writer exists
// or is planned — so the full stage enum appears in the PATCH contract. The
// append-only strictness lives in the EVENTS instead (M4-02 reads outcomes
// for matching feedback): `stage_change` events are system-written on every
// transition and unrepresentable in the events POST contract below. No
// application payload ever carries posting rawText — the posting summary is
// display metadata only (pinned by the spec tripwire in apps/api).

/** Same cost/abuse bound rationale as posting metadata caps: event details
 *  are user-authored notes, not hostile input, but still bounded. */
export const APPLICATION_EVENT_DETAIL_MAX_CHARS = 5000;

/**
 * Event kinds a USER may write via POST /applications/:id/events.
 * `stage_change` is system-only — emitted by the service on every stage
 * transition, in the same transaction as the update — and is unrepresentable
 * here (the M1-02 unrepresentable-statuses move, applied to event kinds):
 * hand-writing one would assert a transition that never happened.
 */
export const USER_APPLICATION_EVENT_KINDS = ['note', 'outcome'] as const;

export const applicationCreateBodySchema = z.object({
  postingId: z.uuid(),
});
export type ApplicationCreateBody = z.infer<typeof applicationCreateBodySchema>;

export const applicationSchema = z.object({
  id: z.string(),
  postingId: z.string(),
  stage: applicationStageSchema,
  appliedOn: z.iso.date().nullable(),
  createdAt: z.iso.datetime(),
});
export type Application = z.infer<typeof applicationSchema>;

/** Display metadata from the tracked posting — NEVER rawText (its single
 *  wire path stays the posting detail GET, M1-02 wire-path law). */
export const applicationPostingSummarySchema = z.object({
  company: z.string().nullable(),
  title: z.string().nullable(),
});
export type ApplicationPostingSummary = z.infer<typeof applicationPostingSummarySchema>;

export const applicationWithPostingSchema = applicationSchema.extend({
  posting: applicationPostingSummarySchema,
});
export type ApplicationWithPosting = z.infer<typeof applicationWithPostingSchema>;

/**
 * 201 = created; 200 with `duplicate: true` = an application for this posting
 * already exists (at most one per posting — the ERD's "tracked as" 0-or-1,
 * UNIQUE in the schema) and `application` is the STORED record. The M1-01
 * ingest-response mirror: re-tracking is a normal action, not a 409 — the
 * client gets the record either way and navigates to it.
 */
export const applicationCreateResponseSchema = z.object({
  application: applicationSchema,
  duplicate: z.boolean(),
});
export type ApplicationCreateResponse = z.infer<typeof applicationCreateResponseSchema>;

export const applicationListResponseSchema = z.object({
  applications: z.array(applicationWithPostingSchema),
});
export type ApplicationListResponse = z.infer<typeof applicationListResponseSchema>;

/** Responses carry the FULL kind enum — the trail includes system-written
 *  stage_change events; only the write contract narrows the kinds. */
export const applicationEventSchema = z.object({
  id: z.string(),
  kind: applicationEventKindSchema,
  detail: z.string().nullable(),
  occurredOn: z.iso.date(),
  createdAt: z.iso.datetime(),
});
export type ApplicationEvent = z.infer<typeof applicationEventSchema>;

/** Detail = the application, its posting summary, and the full event trail in
 *  chronological order (occurredOn, then createdAt, then id). */
export const applicationDetailSchema = applicationWithPostingSchema.extend({
  events: z.array(applicationEventSchema),
});
export type ApplicationDetail = z.infer<typeof applicationDetailSchema>;

/**
 * Stage transitions (PATCH). Any DISTINCT stage is reachable from any other —
 * a personal tracker's real searches loop (rejected → considering on a
 * re-post), and a too-strict graph fights its only user; fidelity comes from
 * the mandatory stage_change event, not transition rigidity. `occurredOn` is
 * the transition's date (events log stage changes WITH dates — "I applied
 * last Friday" is the normal case); the server defaults it to today when
 * absent, and it — never server-now — becomes `appliedOn` on the first
 * transition into 'applied'.
 */
export const applicationStageUpdateBodySchema = z.object({
  stage: applicationStageSchema,
  occurredOn: z.iso.date().optional(),
});
export type ApplicationStageUpdateBody = z.infer<typeof applicationStageUpdateBodySchema>;

/**
 * User-written events: notes and outcomes only (see
 * USER_APPLICATION_EVENT_KINDS). `detail` is required for both — a
 * detail-free outcome carries nothing the terminal stage_change event doesn't
 * already record; its entire value is the "why". regex(/\S/): whitespace-only
 * detail is no detail at all (the posting-paste precedent).
 */
export const applicationEventCreateBodySchema = z.object({
  kind: z.enum(USER_APPLICATION_EVENT_KINDS),
  detail: z.string().min(1).max(APPLICATION_EVENT_DETAIL_MAX_CHARS).regex(/\S/),
  occurredOn: z.iso.date().optional(),
});
export type ApplicationEventCreateBody = z.infer<typeof applicationEventCreateBodySchema>;
