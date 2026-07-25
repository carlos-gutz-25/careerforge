import { describe, expect, it } from 'vitest';

import {
  computeRevisitState,
  REVISIT_INTERVALS_DAYS,
  reviewQueueItemSchema,
  reviewQueueResponseSchema,
} from './revisit.ts';

// M3-05 due-ness computation — table-driven over the rolling ladder. All
// dates fictional. The ladder-order cases double as the planted-FAIL target
// for this story's new invariant (inverting REVISIT_INTERVALS_DAYS must turn
// them RED).

describe('REVISIT_INTERVALS_DAYS (the ladder)', () => {
  it('is exactly 7/30/90 in ascending order', () => {
    expect(REVISIT_INTERVALS_DAYS).toEqual([7, 30, 90]);
  });
});

describe('computeRevisitState — rolling ladder', () => {
  it('k=0: due exactly 7 days after completion, not a day sooner', () => {
    const base = { completedOn: '2026-07-01', revisitedDates: [] };
    const before = computeRevisitState({ ...base, today: '2026-07-07' });
    expect(before).toEqual({
      revisitCount: 0,
      graduated: false,
      dueOn: '2026-07-08',
      intervalDays: 7,
      isDue: false,
    });
    const onDay = computeRevisitState({ ...base, today: '2026-07-08' });
    expect(onDay.isDue).toBe(true);
    const overdue = computeRevisitState({ ...base, today: '2026-08-01' });
    expect(overdue.isDue).toBe(true);
    expect(overdue.dueOn).toBe('2026-07-08');
  });

  it('k=1: due 30 days after the FIRST revisit (rolling, not completion-anchored)', () => {
    const state = computeRevisitState({
      completedOn: '2026-07-01',
      // A LATE first revisit (day 40): the next check rolls from it — no
      // immediate re-due, no double-count (the fixed-ladder failure mode).
      revisitedDates: ['2026-08-10'],
      today: '2026-08-11',
    });
    expect(state).toEqual({
      revisitCount: 1,
      graduated: false,
      dueOn: '2026-09-09',
      intervalDays: 30,
      isDue: false,
    });
  });

  it('k=2: due 90 days after the SECOND revisit', () => {
    const state = computeRevisitState({
      completedOn: '2026-07-01',
      revisitedDates: ['2026-07-08', '2026-08-07'],
      today: '2026-11-05',
    });
    expect(state).toEqual({
      revisitCount: 2,
      graduated: false,
      dueOn: '2026-11-05',
      intervalDays: 90,
      isDue: true,
    });
  });

  it('k=3: graduated — leaves the queue forever, never due again', () => {
    const state = computeRevisitState({
      completedOn: '2026-07-01',
      revisitedDates: ['2026-07-08', '2026-08-07', '2026-11-06'],
      today: '2030-01-01',
    });
    expect(state).toEqual({
      revisitCount: 3,
      graduated: true,
      dueOn: null,
      intervalDays: null,
      isDue: false,
    });
  });

  it('counts revisits by COUNT, not spacing: three consecutive-day revisits graduate (accepted wrinkle, M3-05a parks the refinement)', () => {
    const state = computeRevisitState({
      completedOn: '2026-07-01',
      revisitedDates: ['2026-07-02', '2026-07-03', '2026-07-04'],
      today: '2026-07-05',
    });
    expect(state.graduated).toBe(true);
  });

  it('unsorted revisitedDates: the LATEST counted revisit anchors the next interval', () => {
    const state = computeRevisitState({
      completedOn: '2026-07-01',
      revisitedDates: ['2026-08-07', '2026-07-08'],
      today: '2026-08-08',
    });
    expect(state.revisitCount).toBe(2);
    expect(state.dueOn).toBe('2026-11-05');
  });
});

describe('computeRevisitState — strict > epoch filter', () => {
  it('a revisit recorded ON the completion day does not count (strict >)', () => {
    const state = computeRevisitState({
      completedOn: '2026-07-01',
      revisitedDates: ['2026-07-01'],
      today: '2026-07-02',
    });
    expect(state.revisitCount).toBe(0);
    expect(state.dueOn).toBe('2026-07-08');
  });

  it('revisits recorded BEFORE completion do not count (backdated / prior work)', () => {
    const state = computeRevisitState({
      completedOn: '2026-07-01',
      revisitedDates: ['2026-06-01', '2026-06-15'],
      today: '2026-07-02',
    });
    expect(state.revisitCount).toBe(0);
  });

  it('epoch reset: after a re-completion TODAY, every old-epoch revisit (<= today) is excluded — the ladder starts clean', () => {
    // reject-future guarantees recorded_on <= today; the restamp sets
    // completed_on = today; strict > therefore excludes ALL prior rows,
    // including a same-day one from the old epoch.
    const state = computeRevisitState({
      completedOn: '2026-07-20',
      revisitedDates: ['2026-07-08', '2026-07-15', '2026-07-19', '2026-07-20'],
      today: '2026-07-20',
    });
    expect(state).toEqual({
      revisitCount: 0,
      graduated: false,
      dueOn: '2026-07-27',
      intervalDays: 7,
      isDue: false,
    });
  });
});

describe('computeRevisitState — calendar arithmetic (Hinnant day math)', () => {
  it('crosses a year boundary', () => {
    const state = computeRevisitState({
      completedOn: '2026-12-28',
      revisitedDates: [],
      today: '2026-12-28',
    });
    expect(state.dueOn).toBe('2027-01-04');
  });

  it('crosses February in a leap year', () => {
    const state = computeRevisitState({
      completedOn: '2028-02-27',
      revisitedDates: [],
      today: '2028-02-27',
    });
    expect(state.dueOn).toBe('2028-03-05');
  });

  it('crosses February in a non-leap year', () => {
    const state = computeRevisitState({
      completedOn: '2027-02-27',
      revisitedDates: [],
      today: '2027-02-27',
    });
    expect(state.dueOn).toBe('2027-03-06');
  });

  it('a 30-day interval spans a month boundary', () => {
    const state = computeRevisitState({
      completedOn: '2026-07-01',
      revisitedDates: ['2026-07-15'],
      today: '2026-07-16',
    });
    expect(state.dueOn).toBe('2026-08-14');
  });
});

describe('review-queue wire contracts', () => {
  const item = {
    exerciseId: '22222222-2222-4222-8222-222222222222',
    title: 'Rebuild the rate limiter kata',
    kind: 'kata' as const,
    learningPlanId: '33333333-3333-4333-8333-333333333333',
    completedOn: '2026-07-01',
    revisitCount: 1,
    intervalDays: 30,
    dueOn: '2026-08-07',
  };

  it('accepts a well-formed queue item and response', () => {
    expect(reviewQueueItemSchema.parse(item)).toEqual(item);
    expect(reviewQueueResponseSchema.parse({ items: [item] })).toEqual({ items: [item] });
    expect(reviewQueueResponseSchema.parse({ items: [] })).toEqual({ items: [] });
  });

  it('rejects unknown keys (strict wire shape)', () => {
    expect(reviewQueueItemSchema.safeParse({ ...item, userId: 'u' }).success).toBe(false);
  });

  it('rejects a graduated-shaped item (null dueOn/intervalDays never cross the wire)', () => {
    expect(reviewQueueItemSchema.safeParse({ ...item, dueOn: null }).success).toBe(false);
    expect(reviewQueueItemSchema.safeParse({ ...item, intervalDays: null }).success).toBe(false);
  });

  it('rejects a non-date completedOn/dueOn', () => {
    expect(reviewQueueItemSchema.safeParse({ ...item, completedOn: 'yesterday' }).success).toBe(
      false,
    );
    expect(reviewQueueItemSchema.safeParse({ ...item, dueOn: '2026-8-7' }).success).toBe(false);
  });
});
