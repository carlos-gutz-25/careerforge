import { type Posting, type PostingIngestBody } from '@careerforge/core';
import { type JobPosting, type PostingsRepository } from '@careerforge/db';

import { postingContentHash } from './content-hash.ts';

export interface PostingIngestResult {
  posting: Posting;
  duplicate: boolean;
}

export interface PostingsService {
  ingest(userId: string, body: PostingIngestBody): Promise<PostingIngestResult>;
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
function toWire(row: JobPosting): Posting {
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
  };
}
