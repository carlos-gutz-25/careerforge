import { describe, expect, it } from 'vitest';

import {
  CITATION_SOURCE_KINDS,
  RESUME_COMPOSE_RUN_STATUSES,
  RESUME_DOCUMENT_REVIEW_STATUSES,
} from './enums.ts';
import { profileContactLinkSchema, profileContactLinksSchema } from './profile.ts';
import {
  canonicalResumeDocSchema,
  fitReportResumeDocumentResponseSchema,
  parseAuditReportSchema,
  RESUME_AUDIT_FORMATS,
  RESUME_EXPORT_FORMATS,
  resumeComposeRunSchema,
  resumeDocumentResponseSchema,
  resumeDocumentReviewBodySchema,
  resumeExportFormatSchema,
  type CanonicalResumeDoc,
  type ParseAuditReport,
  type ResumeComposeRun,
  type ResumeDocumentResponse,
} from './resume-document.ts';

// All fixture data is fictional (RISKS P-01) - the Robin Vale persona.

function runRow(overrides: Partial<ResumeComposeRun> = {}): ResumeComposeRun {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    promptId: 'resume-compose@v1',
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    status: 'ok',
    attempt: 1,
    inputTokens: 2600,
    outputTokens: 640,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    latencyMs: 4800,
    createdAt: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

function canonicalDoc(overrides: Partial<CanonicalResumeDoc> = {}): CanonicalResumeDoc {
  return {
    contact: {
      fullName: 'Robin Vale',
      headline: 'Senior Software Engineer',
      email: 'robin@example.com',
      phone: null,
      location: 'Rivertown',
      links: [{ label: 'GitHub', url: 'https://github.example/robinvale' }],
    },
    education: [
      {
        institution: 'Rivertown University',
        credential: 'BS Computer Science',
        startYear: 2012,
        endYear: 2016,
      },
    ],
    skills: [{ name: 'TypeScript', level: 'expert' }],
    claims: [
      {
        section: 'summary',
        entityRef: null,
        entityLabel: null,
        text: 'Full-stack engineer.',
        position: 0,
      },
      {
        section: 'experience',
        entityRef: 'x1',
        entityLabel: 'Acme Widgets - Senior Engineer',
        text: 'Shipped the billing service.',
        position: 1,
      },
    ],
    ...overrides,
  };
}

function documentRow(overrides: Partial<ResumeDocumentResponse> = {}): ResumeDocumentResponse {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    fitReportId: '66666666-6666-4666-8666-666666666666',
    revision: 1,
    reviewStatus: 'draft',
    supersededAt: null,
    stale: false,
    notes: null,
    createdAt: '2026-01-02T03:04:05.000Z',
    canonicalDoc: canonicalDoc(),
    claims: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        section: 'experience',
        entityRef: 'x1',
        entityLabel: 'Acme Widgets - Senior Engineer',
        text: 'Shipped the billing service.',
        position: 0,
        citations: [
          {
            sourceKind: 'experience_bullet',
            sourceText: 'Built and shipped billing.',
            position: 0,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('resume-compose status enums', () => {
  it('carries the five wire statuses plus the flagged + empty policy statuses', () => {
    expect(RESUME_COMPOSE_RUN_STATUSES).toContain('ok');
    expect(RESUME_COMPOSE_RUN_STATUSES).toContain('flagged');
    expect(RESUME_COMPOSE_RUN_STATUSES).toContain('empty');
    // empty is DISTINCT from flagged (a policy separation, not a synonym).
    expect(new Set(RESUME_COMPOSE_RUN_STATUSES).size).toBe(RESUME_COMPOSE_RUN_STATUSES.length);
  });

  it('review statuses are draft->reviewed and source kinds are the four profile classes', () => {
    expect(RESUME_DOCUMENT_REVIEW_STATUSES).toEqual(['draft', 'reviewed']);
    expect(CITATION_SOURCE_KINDS).toEqual([
      'experience_bullet',
      'mastery_evidence',
      'project',
      'summary',
    ]);
  });
});

describe('profileContactLink read schema (obligation 1)', () => {
  it('accepts a valid {label, url} pair', () => {
    expect(
      profileContactLinkSchema.parse({ label: 'GitHub', url: 'https://github.example/x' }),
    ).toEqual({
      label: 'GitHub',
      url: 'https://github.example/x',
    });
  });

  it('rejects a link missing url', () => {
    expect(profileContactLinkSchema.safeParse({ label: 'GitHub' }).success).toBe(false);
  });

  it('rejects an unknown extra key (strict) and parses an array', () => {
    expect(profileContactLinkSchema.safeParse({ label: 'x', url: 'y', extra: 1 }).success).toBe(
      false,
    );
    expect(profileContactLinksSchema.parse([{ label: 'a', url: 'b' }])).toHaveLength(1);
  });
});

describe('canonicalResumeDocSchema', () => {
  it('accepts a representative fictional snapshot', () => {
    expect(canonicalResumeDocSchema.parse(canonicalDoc())).toBeTruthy();
  });

  it('rejects an unknown top-level key (strict snapshot)', () => {
    expect(canonicalResumeDocSchema.safeParse({ ...canonicalDoc(), posting: 'leak' }).success).toBe(
      false,
    );
  });

  it('accepts an empty claims/education/skills document (the empty shape parses)', () => {
    expect(
      canonicalResumeDocSchema.safeParse(canonicalDoc({ claims: [], education: [], skills: [] }))
        .success,
    ).toBe(true);
  });
});

describe('run + document + result wire schemas', () => {
  it('parses a compose run row', () => {
    expect(resumeComposeRunSchema.parse(runRow())).toBeTruthy();
    expect(resumeComposeRunSchema.parse(runRow({ status: 'flagged' })).status).toBe('flagged');
  });

  it('parses a document row with claims + citations', () => {
    expect(resumeDocumentResponseSchema.parse(documentRow())).toBeTruthy();
  });

  it('models a non-persisting outcome as document:null with run.status the discriminant', () => {
    const flagged = fitReportResumeDocumentResponseSchema.parse({
      run: runRow({ status: 'flagged' }),
      document: null,
      cached: false,
    });
    expect(flagged.document).toBeNull();
    expect(flagged.run?.status).toBe('flagged');
    const empty = fitReportResumeDocumentResponseSchema.parse({
      run: runRow({ status: 'empty' }),
      document: null,
      cached: false,
    });
    expect(empty.run?.status).toBe('empty');
  });

  it('models a cache hit as document non-null, cached:true, run:null', () => {
    const cached = fitReportResumeDocumentResponseSchema.parse({
      run: null,
      document: documentRow(),
      cached: true,
    });
    expect(cached.cached).toBe(true);
    expect(cached.document).not.toBeNull();
  });
});

describe('resumeDocumentReviewBodySchema', () => {
  it('accepts nullish and trimmed notes', () => {
    expect(resumeDocumentReviewBodySchema.parse({}).notes).toBeUndefined();
    expect(resumeDocumentReviewBodySchema.parse({ notes: 'looks good' }).notes).toBe('looks good');
  });

  it('rejects over-long notes and a U+0000 in notes', () => {
    expect(resumeDocumentReviewBodySchema.safeParse({ notes: 'x'.repeat(10_001) }).success).toBe(
      false,
    );
    const withNul = `bad${String.fromCharCode(0)}note`;
    expect(resumeDocumentReviewBodySchema.safeParse({ notes: withNul }).success).toBe(false);
  });
});

describe('M6-05 export/audit contracts', () => {
  it('the export enum is the five formats and round-trips each', () => {
    expect(RESUME_EXPORT_FORMATS).toEqual(['pdf', 'docx', 'markdown', 'plaintext', 'json']);
    for (const format of RESUME_EXPORT_FORMATS) {
      expect(resumeExportFormatSchema.parse(format)).toBe(format);
    }
    expect(resumeExportFormatSchema.safeParse('html').success).toBe(false);
  });

  it('the audit enum is the two binary formats (md/txt/json have no round-trip)', () => {
    expect(RESUME_AUDIT_FORMATS).toEqual(['pdf', 'docx']);
  });

  it('accepts a representative report and rejects an unknown key (strict)', () => {
    const report: ParseAuditReport = {
      parseIntegrity: { ok: true, missing: [], outOfOrder: [] },
      evidenceIntegrity: { ok: true, missingClaims: [] },
      honesty: 'Deterministic render-fidelity check.',
    };
    expect(parseAuditReportSchema.parse(report)).toEqual(report);
    expect(parseAuditReportSchema.safeParse({ ...report, atsScore: 92 }).success).toBe(false);
  });

  it('carries structural anchor labels and dropped-claim positions as named specifics', () => {
    const failing = parseAuditReportSchema.parse({
      parseIntegrity: { ok: false, missing: ['Experience'], outOfOrder: ['Skills'] },
      evidenceIntegrity: { ok: false, missingClaims: [2] },
      honesty: 'x',
    });
    expect(failing.parseIntegrity.missing).toEqual(['Experience']);
    expect(failing.evidenceIntegrity.missingClaims).toEqual([2]);
  });
});
