import { and, asc, desc, eq } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { jobPostings } from '../schema/jobs.ts';

export type JobPosting = typeof jobPostings.$inferSelect;

/** The list projection: everything EXCEPT rawText/contentHash. The list
 *  path never selects posting text — its single wire path is the detail GET
 *  (M1-02), and not fetching it here enforces that below the HTTP layer. */
export type JobPostingMeta = Omit<JobPosting, 'rawText' | 'contentHash'>;

const metaColumns = {
  id: jobPostings.id,
  userId: jobPostings.userId,
  company: jobPostings.company,
  title: jobPostings.title,
  sourceNote: jobPostings.sourceNote,
  status: jobPostings.status,
  createdAt: jobPostings.createdAt,
  updatedAt: jobPostings.updatedAt,
};

/** Ingest payload: apps/api owns hashing and metadata trimming; this
 *  repository owns how a paste lands in Postgres. rawText is UNTRUSTED and
 *  stored verbatim (schema comment, CLAUDE.md hard rule). */
export interface PostingIngestData {
  rawText: string;
  contentHash: string;
  company: string | null;
  title: string | null;
  sourceNote: string | null;
}

export interface PostingsRepository {
  /**
   * Inserts the posting, or returns the user's existing row for the same
   * content hash (`created: false`). Race-safe by construction: INSERT …
   * ON CONFLICT (user_id, content_hash) DO NOTHING against the schema's
   * unique dedupe boundary, then a read of whichever row won — no
   * read-then-write window. The existing row is returned UNTOUCHED:
   * duplicate-paste metadata is discarded (first-write wins, M1-01).
   */
  ingest(
    userId: string,
    data: PostingIngestData,
  ): Promise<{ posting: JobPosting; created: boolean }>;

  /** Metadata-only list (rawText never selected), newest paste first with an
   *  id tiebreak so the order is deterministic (profile-read precedent). */
  listForUser(userId: string): Promise<JobPostingMeta[]>;

  /** Full row (the detail path needs rawText); undefined when the id doesn't
   *  exist OR belongs to another user — callers can't tell the difference,
   *  which is the point (user-scoped 404). */
  findForUser(userId: string, id: string): Promise<JobPosting | undefined>;

  /**
   * Conditional status update: UPDATE … WHERE user_id AND id AND
   * status = expectedCurrent, RETURNING. undefined = zero rows — the row
   * vanished or its status changed concurrently; no read-then-write window
   * (the ingest ON CONFLICT precedent, applied to updates).
   */
  updateStatus(
    userId: string,
    id: string,
    expectedCurrent: JobPosting['status'],
    next: JobPosting['status'],
  ): Promise<JobPosting | undefined>;
}

export function createPostingsRepository(db: Db): PostingsRepository {
  return {
    async ingest(userId, data) {
      const [inserted] = await db
        .insert(jobPostings)
        .values({ userId, ...data })
        .onConflictDoNothing({ target: [jobPostings.userId, jobPostings.contentHash] })
        .returning();
      if (inserted) return { posting: inserted, created: true };

      const [existing] = await db
        .select()
        .from(jobPostings)
        .where(and(eq(jobPostings.userId, userId), eq(jobPostings.contentHash, data.contentHash)));
      // Unreachable outside a concurrent delete between the two statements:
      // the conflict row must exist for DO NOTHING to have swallowed the
      // insert. Fail loudly rather than fabricate a result.
      if (!existing) throw new Error('job_postings dedupe row vanished between insert and read');
      return { posting: existing, created: false };
    },

    async listForUser(userId) {
      return db
        .select(metaColumns)
        .from(jobPostings)
        .where(eq(jobPostings.userId, userId))
        .orderBy(desc(jobPostings.createdAt), asc(jobPostings.id));
    },

    async findForUser(userId, id) {
      const [posting] = await db
        .select()
        .from(jobPostings)
        .where(and(eq(jobPostings.userId, userId), eq(jobPostings.id, id)));
      return posting;
    },

    async updateStatus(userId, id, expectedCurrent, next) {
      const [updated] = await db
        .update(jobPostings)
        .set({ status: next })
        .where(
          and(
            eq(jobPostings.userId, userId),
            eq(jobPostings.id, id),
            eq(jobPostings.status, expectedCurrent),
          ),
        )
        .returning();
      return updated;
    },
  };
}
