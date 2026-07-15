import { and, eq } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { jobPostings } from '../schema/jobs.ts';

export type JobPosting = typeof jobPostings.$inferSelect;

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
  };
}
