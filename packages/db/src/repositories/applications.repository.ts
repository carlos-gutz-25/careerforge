import { and, asc, desc, eq, getTableColumns } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { applicationEvents, applications, jobPostings } from '../schema/jobs.ts';

export type ApplicationRow = typeof applications.$inferSelect;
export type ApplicationEventRow = typeof applicationEvents.$inferSelect;

/** List/detail projection: the application plus display metadata from its
 *  posting — company/title ONLY, never rawText (its single wire path stays
 *  the posting detail GET, M1-02 wire-path law, enforced below the HTTP
 *  layer by never selecting it here). */
export type ApplicationWithPostingRow = ApplicationRow & {
  posting: { company: string | null; title: string | null };
};

export interface ApplicationEventInsert {
  kind: ApplicationEventRow['kind'];
  detail: string | null;
  occurredOn: string;
}

/** Either the root handle or an open transaction — the shape insertEventRow
 *  needs from both. */
type DbExecutor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * THE single event-insert callsite (M1-03 one-writer rule, repo layer):
 * `transitionStage` (inside its transaction) and `addEvent` both land here;
 * no other path may insert into application_events.
 */
async function insertEventRow(
  executor: DbExecutor,
  userId: string,
  applicationId: string,
  event: ApplicationEventInsert,
): Promise<ApplicationEventRow> {
  const [row] = await executor
    .insert(applicationEvents)
    .values({ userId, applicationId, ...event })
    .returning();
  if (!row) throw new Error('application_events insert returned no row');
  return row;
}

const postingSummary = {
  company: jobPostings.company,
  title: jobPostings.title,
};

export interface ApplicationsRepository {
  /**
   * Creates the application for a posting, or returns the existing one
   * (`created: false`) — at most one per posting (ERD "tracked as" 0-or-1,
   * UNIQUE on posting_id). Race-safe by construction: INSERT … ON CONFLICT
   * DO NOTHING, then a read of whichever row won — no read-then-write window
   * (the M1-01 ingest precedent). Caller must have verified the posting
   * belongs to this user; the conflict row is then necessarily this user's.
   */
  create(
    userId: string,
    postingId: string,
  ): Promise<{ application: ApplicationRow; created: boolean }>;

  /** Applications with posting summaries, newest-tracked first with an id
   *  tiebreak (deterministic order, postings precedent); filters apply in
   *  SQL. */
  listForUser(
    userId: string,
    filter: { stage?: ApplicationRow['stage']; postingId?: string },
  ): Promise<ApplicationWithPostingRow[]>;

  /** undefined when the id doesn't exist OR belongs to another user —
   *  callers can't tell the difference, which is the point (user-scoped
   *  404). */
  findForUser(userId: string, id: string): Promise<ApplicationWithPostingRow | undefined>;

  /** The trail in chronological order: occurredOn, then createdAt, then id
   *  (deterministic tiebreak). */
  listEvents(userId: string, applicationId: string): Promise<ApplicationEventRow[]>;

  /**
   * Stage transition + its system-written stage_change event in ONE
   * transaction. The update is conditional (WHERE stage = expectedCurrent,
   * the M1-02 no-read-then-write pattern): zero rows → undefined and the
   * transaction writes NOTHING — no event may record a transition that
   * didn't happen. `update.appliedOn` is set only when provided (first
   * transition into 'applied'; the service decides).
   */
  transitionStage(
    userId: string,
    id: string,
    expectedCurrent: ApplicationRow['stage'],
    update: { stage: ApplicationRow['stage']; appliedOn?: string },
    event: ApplicationEventInsert,
  ): Promise<ApplicationRow | undefined>;

  /** Append a user-written event (note/outcome — the service constrains
   *  kinds). Caller must have verified the application belongs to the
   *  user. */
  addEvent(
    userId: string,
    applicationId: string,
    event: ApplicationEventInsert,
  ): Promise<ApplicationEventRow>;
}

export function createApplicationsRepository(db: Db): ApplicationsRepository {
  return {
    async create(userId, postingId) {
      const [inserted] = await db
        .insert(applications)
        .values({ userId, postingId })
        .onConflictDoNothing({ target: applications.postingId })
        .returning();
      if (inserted) return { application: inserted, created: true };

      const [existing] = await db
        .select()
        .from(applications)
        .where(and(eq(applications.userId, userId), eq(applications.postingId, postingId)));
      // Unreachable outside a concurrent delete between the two statements
      // (postings.ingest precedent): fail loudly rather than fabricate.
      if (!existing) throw new Error('applications row vanished between insert and read');
      return { application: existing, created: false };
    },

    async listForUser(userId, filter) {
      const conditions = [eq(applications.userId, userId)];
      if (filter.stage) conditions.push(eq(applications.stage, filter.stage));
      if (filter.postingId) conditions.push(eq(applications.postingId, filter.postingId));
      return db
        .select({ ...getTableColumns(applications), posting: postingSummary })
        .from(applications)
        .innerJoin(jobPostings, eq(applications.postingId, jobPostings.id))
        .where(and(...conditions))
        .orderBy(desc(applications.createdAt), asc(applications.id));
    },

    async findForUser(userId, id) {
      const [row] = await db
        .select({ ...getTableColumns(applications), posting: postingSummary })
        .from(applications)
        .innerJoin(jobPostings, eq(applications.postingId, jobPostings.id))
        .where(and(eq(applications.userId, userId), eq(applications.id, id)));
      return row;
    },

    async listEvents(userId, applicationId) {
      return db
        .select()
        .from(applicationEvents)
        .where(
          and(
            eq(applicationEvents.userId, userId),
            eq(applicationEvents.applicationId, applicationId),
          ),
        )
        .orderBy(
          asc(applicationEvents.occurredOn),
          asc(applicationEvents.createdAt),
          asc(applicationEvents.id),
        );
    },

    transitionStage(userId, id, expectedCurrent, update, event) {
      return db.transaction(async (tx) => {
        const [updated] = await tx
          .update(applications)
          .set(update)
          .where(
            and(
              eq(applications.userId, userId),
              eq(applications.id, id),
              eq(applications.stage, expectedCurrent),
            ),
          )
          .returning();
        if (!updated) return undefined;
        await insertEventRow(tx, userId, id, event);
        return updated;
      });
    },

    async addEvent(userId, applicationId, event) {
      return insertEventRow(db, userId, applicationId, event);
    },
  };
}
