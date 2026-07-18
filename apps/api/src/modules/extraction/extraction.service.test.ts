// R1 behavior pins (external code review, M1-05): the raw-response sanitizer
// strips real U+0000 CHARACTERS on the parsed structure and never touches the
// literal 6-char escape TEXT backslash-u-0000 — the serialized-JSON text
// replacement it replaced could not tell the two apart and corrupted the
// text case (route-level regression lives in extraction.routes.test.ts).
//
// Also home of the doubly-failed audit-branch pins (O-4 pre-task, M1-07 park
// homed as M1-09 slice 1): provider AND persistence both down is the one
// branch the route-level 502 test cannot reach (it needs a working database
// to run at all), so it is pinned here against stub repositories.
import {
  type ExtractionRunInsert,
  type ExtractionsRepository,
  type JobPosting,
  type PostingsRepository,
  type RequirementInsert,
} from '@careerforge/db';
import { type LlmProvider } from '@careerforge/llm';
import { describe, expect, it } from 'vitest';

import {
  createExtractionService,
  LlmUpstreamError,
  stripNulChars,
  toPlainJson,
} from './extraction.service.ts';

// The real character, constructed — no literal NUL byte in this source file.
const NUL = String.fromCharCode(0);

describe('raw-response NUL sanitization (R1)', () => {
  it('(a) literal backslash-u-0000 TEXT survives byte-identical, no throw', () => {
    const input = {
      q: 'code: \\u0000 terminator',
      nested: { list: ['\\u0000', 'plain'] },
    };
    expect(stripNulChars(toPlainJson(input))).toEqual(input);
  });

  it('(b) real U+0000 characters are stripped from string VALUES and object KEYS', () => {
    const input = {
      [`ke${NUL}y`]: `va${NUL}lue`,
      arr: [`x${NUL}${NUL}y`, 7, true, null],
      untouched: 'plain string',
    };
    expect(stripNulChars(toPlainJson(input))).toEqual({
      key: 'value',
      arr: ['xy', 7, true, null],
      untouched: 'plain string',
    });
  });

  it('a mixed payload keeps the text form while losing the character', () => {
    const input = { s: `literal \\u0000 and real${NUL} together` };
    expect(stripNulChars(toPlainJson(input))).toEqual({
      s: 'literal \\u0000 and real together',
    });
  });

  it('toPlainJson normalizes non-JSON values instead of throwing', () => {
    expect(toPlainJson(undefined)).toBeNull();
    expect(toPlainJson({ keep: 1, drop: undefined })).toEqual({ keep: 1 });
  });
});

// Every id and string below is fictional (RISKS P-01).
const FICTIONAL_USER_ID = '11111111-1111-4111-8111-111111111111';

function fictionalPosting(): JobPosting {
  const pasted = new Date('2026-07-18T09:00:00.000Z');
  return {
    id: '22222222-2222-4222-8222-222222222222',
    userId: FICTIONAL_USER_ID,
    rawText: 'Fictional Widgets Inc. seeks an engineer. Requirements: 5+ years TypeScript.',
    contentHash: 'c'.repeat(64),
    company: 'Fictional Widgets Inc.',
    title: 'Senior Engineer',
    sourceNote: null,
    status: 'new',
    createdAt: pasted,
    updatedAt: pasted,
  };
}

/** A provider whose one generate() call rejects — runPrompt records exactly
 *  one value-free 'error' row (attempt 1) and rethrows. */
function failingProvider(): LlmProvider {
  const upstream = new Error('fictional upstream detail — must never surface');
  upstream.name = 'FictionalProviderError';
  return { name: 'anthropic', generate: () => Promise.reject(upstream) };
}

function buildService(persistExtraction: ExtractionsRepository['persistExtraction']) {
  const postings = {
    findForUser: () => Promise.resolve(fictionalPosting()),
  } as unknown as PostingsRepository;
  const extractions = {
    findLatestRequirementBearingRun: () => Promise.resolve(undefined),
    persistExtraction,
  } as unknown as ExtractionsRepository;
  return createExtractionService({ postings, extractions, provider: failingProvider() });
}

async function rejectionOf(promise: Promise<unknown>): Promise<LlmUpstreamError> {
  await expect(promise).rejects.toBeInstanceOf(LlmUpstreamError);
  return promise.then(
    () => {
      throw new Error('unreachable: the rejection was asserted above');
    },
    (error: unknown) => error as LlmUpstreamError,
  );
}

describe('extract — provider-error audit recording (O-4 doubly-failed branch)', () => {
  it('provider down, persistence up: the error record persists and the 502 carries no audit note', async () => {
    const persisted: {
      runs: ExtractionRunInsert[];
      requirements: RequirementInsert[] | undefined;
    }[] = [];
    const service = buildService((_userId, _postingId, runs, requirementInserts) => {
      persisted.push({ runs, requirements: requirementInserts });
      // The error path discards the outcome; an empty one satisfies the type.
      return Promise.resolve({ runs: [], requirements: [], postingFlipped: false });
    });

    const error = await rejectionOf(
      service.extract(FICTIONAL_USER_ID, fictionalPosting().id, true),
    );

    expect(error.statusCode).toBe(502);
    expect(error.code).toBe('LLM_UPSTREAM_ERROR');
    // Upstream error NAME only — no audit note on this leg.
    expect(error.message).toBe('LLM provider call failed: FictionalProviderError');
    // The audit row still landed: one value-free 'error' record, no requirements.
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.requirements).toBeUndefined();
    expect(persisted[0]?.runs).toHaveLength(1);
    expect(persisted[0]?.runs[0]).toMatchObject({ status: 'error', attempt: 1 });
  });

  it('provider AND persistence down: best-effort note reports the lost record count, value-free on both legs', async () => {
    let persistAttempts = 0;
    const service = buildService(() => {
      persistAttempts += 1;
      return Promise.reject(new Error('fictional persistence outage — must never surface'));
    });

    const error = await rejectionOf(
      service.extract(FICTIONAL_USER_ID, fictionalPosting().id, true),
    );

    expect(error.statusCode).toBe(502);
    expect(error.code).toBe('LLM_UPSTREAM_ERROR');
    // The P5 best-effort note: count only — the caller learns records were
    // lost without either failure's message (both can echo request content).
    expect(error.message).toBe(
      'LLM provider call failed: FictionalProviderError' +
        ' (audit record persistence also failed; 1 record(s) lost)',
    );
    expect(error.message).not.toContain('fictional upstream detail');
    expect(error.message).not.toContain('fictional persistence outage');
    expect(persistAttempts).toBe(1);
  });
});
