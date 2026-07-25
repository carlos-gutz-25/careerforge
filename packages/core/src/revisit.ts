import { z } from 'zod';

import { exerciseKindSchema } from './enums.ts';

// M3-05: revisit scheduling — the spaced review queue over COMPLETED exercises
// (GET /review-queue). Everything here is PURE and CLOCK-FREE: the caller
// supplies `today` (the server's local calendar date via the injected now
// seam), and all dates are ISO `YYYY-MM-DD` strings compared lexically
// (lexical == chronological for this format). Deterministic date math only —
// NOT LLM-drafted, no run table. Completing a revisit is the EXISTING
// POST /mastery-evidence with kind 'revisited' (no parallel write path).

/**
 * The spaced-review ladder, indexed by how many revisits have been recorded
 * since completion: the first revisit is due 7 days after completion, the
 * second 30 days after the first, the third 90 days after the second (a
 * ROLLING ladder — each interval is measured from the LAST demonstration,
 * not the original completion, so a late revisit never double-counts).
 * After the third revisit the exercise GRADUATES and leaves the queue.
 *
 * Intervals are indexed by COUNT, not enforced as spacing: three revisits
 * recorded on consecutive days graduate in three days. Accepted by decision
 * (evidence is user-authored and trusted); the "a revisit counts only if it
 * was actually due" refinement is parked as BACKLOG story M3-05a.
 */
export const REVISIT_INTERVALS_DAYS = [7, 30, 90] as const;

/** days-from-civil (Howard Hinnant's algorithm): ISO date -> day serial.
 *  Pure integer math, DST-free by construction. A private twin of
 *  packages/scoring/src/dimensions/seniority.ts dayNumber() — core cannot
 *  import scoring (dependency direction), and refactoring scoring's private
 *  helper is out of M3-05's scope. */
function dayNumber(isoDate: string): number {
  const [yearRaw, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const year = month <= 2 ? yearRaw - 1 : yearRaw;
  const era = Math.floor(year / 400);
  const yoe = year - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe;
}

/** civil-from-days (the inverse of dayNumber): day serial -> ISO date. */
function civilFromDays(day: number): string {
  const era = Math.floor((day >= 0 ? day : day - 146096) / 146097);
  const doe = day - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const dayOfMonth = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = month <= 2 ? y + 1 : y;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(dayOfMonth)}`;
}

/** ISO date + n calendar days -> ISO date (round-trips through the serial). */
function addDays(isoDate: string, days: number): string {
  return civilFromDays(dayNumber(isoDate) + days);
}

export interface RevisitStateInput {
  /** The exercise's completion date (ISO `YYYY-MM-DD`, `completed_on`). */
  completedOn: string;
  /** `recorded_on` of the exercise's `revisited` evidence rows, any order. */
  revisitedDates: readonly string[];
  /** The server's local calendar date (ISO `YYYY-MM-DD`). */
  today: string;
}

export interface RevisitState {
  /** Revisits counted toward the ladder (strictly after `completedOn`). */
  revisitCount: number;
  /** True once `REVISIT_INTERVALS_DAYS.length` revisits are counted — the
   *  exercise leaves the queue forever. */
  graduated: boolean;
  /** Next revisit due date; null iff graduated. */
  dueOn: string | null;
  /** The ladder interval that produced `dueOn`; null iff graduated. */
  intervalDays: number | null;
  /** True when `dueOn <= today` (never true once graduated). */
  isDue: boolean;
}

/**
 * The one due-ness computation (GET /review-queue maps completed exercises
 * through this). Only revisits STRICTLY after `completedOn` count — the
 * strict `>` is load-bearing: recordedOn is reject-future (always <= today)
 * and a RE-completion restamps `completed_on` to today, so on any epoch
 * reset every old-epoch revisit (including same-day rows) is excluded with
 * zero extra bookkeeping. The deliberate cost: a genuine same-day revisit of
 * a fresh completion does not advance the ladder (it proves nothing about
 * retention).
 */
export function computeRevisitState(input: RevisitStateInput): RevisitState {
  const counted = input.revisitedDates.filter((date) => date > input.completedOn).sort();
  const revisitCount = counted.length;
  if (revisitCount >= REVISIT_INTERVALS_DAYS.length) {
    return { revisitCount, graduated: true, dueOn: null, intervalDays: null, isDue: false };
  }
  const anchor = revisitCount === 0 ? input.completedOn : (counted[revisitCount - 1] as string);
  const intervalDays = REVISIT_INTERVALS_DAYS[revisitCount] as number;
  const dueOn = addDays(anchor, intervalDays);
  return { revisitCount, graduated: false, dueOn, intervalDays, isDue: dueOn <= input.today };
}

/**
 * One due revisit on the wire (GET /review-queue). `title` is user-authored
 * UNTRUSTED text: escaped on display, never rendered as HTML. `completedOn`
 * surfaces HERE ONLY — it is deliberately NOT added to the Exercise wire
 * shape (existing POST/PATCH/embed responses are unchanged; a reviewer
 * looking for the column on `exerciseSchema` should find this comment).
 * Queue items are never graduated, so `dueOn`/`intervalDays` are always
 * present on the wire. `user_id` never crosses the wire.
 */
export const reviewQueueItemSchema = z.strictObject({
  exerciseId: z.string(),
  title: z.string(),
  kind: exerciseKindSchema,
  learningPlanId: z.string(),
  completedOn: z.iso.date(),
  revisitCount: z.number().int().min(0),
  intervalDays: z.number().int().positive(),
  dueOn: z.iso.date(),
});
export type ReviewQueueItem = z.infer<typeof reviewQueueItemSchema>;

/** GET /review-queue (200) — DUE revisits only (dueOn <= server today),
 *  sorted (dueOn asc, exerciseId asc); graduated exercises never appear. */
export const reviewQueueResponseSchema = z.strictObject({
  items: z.array(reviewQueueItemSchema),
});
export type ReviewQueueResponse = z.infer<typeof reviewQueueResponseSchema>;
