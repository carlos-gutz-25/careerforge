import {
  type JobPostingStatus,
  type Posting,
  type PostingDetail,
  type PostingIngestBody,
  type PostingStatusUpdateBody,
} from '@careerforge/core';
import { type JobPosting, type JobPostingMeta, type PostingsRepository } from '@careerforge/db';

import { postingContentHash } from './content-hash.ts';

export class PostingNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor() {
    // Deliberately id-free: posting ids are caller-supplied path input, and
    // 4xx messages pass through to the response body in every env.
    super('posting not found');
  }
}

export class InvalidStatusTransitionError extends Error {
  readonly statusCode = 409;
  readonly code = 'INVALID_STATUS_TRANSITION';
}

/**
 * The user-transition rule (M1-02): `archived` is reachable from any status
 * (idempotent re-archive included); `new` (unarchive) only from `archived`
 * (or `new`, a no-op). `extracted`/`scored` are pipeline-owned and already
 * unrepresentable in the PATCH contract (packages/core). PARKED for M1-05:
 * once extraction exists, unarchive must restore an artifact-derived status —
 * today `new` is provably lossless because no pipeline writer exists.
 */
function isAllowedTransition(from: JobPostingStatus, to: JobPostingStatus): boolean {
  if (to === 'archived') return true;
  return to === 'new' && (from === 'archived' || from === 'new');
}

export interface PostingIngestResult {
  posting: Posting;
  duplicate: boolean;
}

export interface PostingsService {
  ingest(userId: string, body: PostingIngestBody): Promise<PostingIngestResult>;
  list(userId: string): Promise<Posting[]>;
  /** The ONE read that returns rawText (M1-02 wire-path law). */
  getDetail(userId: string, id: string): Promise<PostingDetail>;
  updateStatus(userId: string, id: string, body: PostingStatusUpdateBody): Promise<Posting>;
}

/** Display-only metadata is normalized at this boundary: trimmed, and
 *  values that trim to empty land as NULL (ratified M1-01). rawText is the
 *  one field that is NEVER touched — stored verbatim as pasted. */
function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The packages/core wire shape; everything else on the row (rawText,
 *  contentHash, userId, timestamps) stays off the response — the serializer
 *  strips undeclared fields as defense-in-depth on top of this projection. */
function toWire(row: JobPosting | JobPostingMeta): Posting {
  return {
    id: row.id,
    company: row.company,
    title: row.title,
    sourceNote: row.sourceNote,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createPostingsService(deps: { postings: PostingsRepository }): PostingsService {
  const { postings } = deps;
  return {
    async ingest(userId, body) {
      const { posting, created } = await postings.ingest(userId, {
        rawText: body.rawText,
        contentHash: postingContentHash(body.rawText),
        company: trimmedOrNull(body.company),
        title: trimmedOrNull(body.title),
        sourceNote: trimmedOrNull(body.sourceNote),
      });
      return { posting: toWire(posting), duplicate: !created };
    },

    async list(userId) {
      const rows = await postings.listForUser(userId);
      return rows.map(toWire);
    },

    async getDetail(userId, id) {
      const row = await postings.findForUser(userId, id);
      // Missing and foreign-owned are the same 404 on purpose (user-scoped
      // read; existence of another user's posting is not observable).
      if (!row) throw new PostingNotFoundError();
      return { ...toWire(row), rawText: row.rawText };
    },

    async updateStatus(userId, id, body) {
      const row = await postings.findForUser(userId, id);
      if (!row) throw new PostingNotFoundError();
      if (!isAllowedTransition(row.status, body.status)) {
        // Value-safe: names only statuses (a closed enum), never user input.
        throw new InvalidStatusTransitionError(
          `cannot set status '${body.status}' from '${row.status}'`,
        );
      }
      // Conditional update pinned to the status we just read: a concurrent
      // transition between read and write yields zero rows, never a blind
      // overwrite. Surfaced as the same 409 — the caller's view was stale.
      const updated = await postings.updateStatus(userId, id, row.status, body.status);
      if (!updated) {
        throw new InvalidStatusTransitionError('posting status changed concurrently — reload');
      }
      return toWire(updated);
    },
  };
}
