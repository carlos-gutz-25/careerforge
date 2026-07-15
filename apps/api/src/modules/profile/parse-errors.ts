/**
 * Stable machine-readable ids for every way a profile source can be rejected.
 * Safe to ship in HTTP responses and logs — a rule id never carries content.
 * Runtime const (not just a type) so the 422 response schema can enumerate
 * the rules in the OpenAPI spec (M0-09).
 */
export const PARSE_RULES = [
  'missing-section',
  'missing-table',
  'empty-table',
  'column-count',
  'missing-field',
  'empty-name',
  'invalid-value',
  'duplicate-entry',
  'unknown-company',
  'file-missing',
] as const;

export type ParseRule = (typeof PARSE_RULES)[number];

/** One actionable problem in a profile source file — never a silent skip. */
export interface ParseIssue {
  /** Source file name relative to the profile directory (e.g. "skills.md"). */
  file: string;
  /** 1-based line the problem anchors to. */
  line: number;
  /** Which part of the source the rule applies to (e.g. "period", "level"). */
  field: string;
  rule: ParseRule;
  /**
   * Human fix-it text; may quote profile content, so it is CLI-stderr-only
   * (RISKS P-01) — never HTTP responses, never pino logs.
   */
  message: string;
}

/**
 * The projection safe for HTTP responses: location + rule, no source content.
 * The web client can point at file:line and name the broken field without the
 * server ever echoing profile values.
 */
export interface RedactedParseIssue {
  file: string;
  line: number;
  field: string;
  rule: ParseRule;
}

export function redactParseIssue(issue: ParseIssue): RedactedParseIssue {
  return { file: issue.file, line: issue.line, field: issue.field, rule: issue.rule };
}

/**
 * Aggregate of every issue found across the profile sources, so one import
 * attempt surfaces all fixes at once. Issue messages can quote profile
 * content — callers must keep them out of pino logs AND HTTP responses
 * (RISKS P-01) and surface them on CLI stderr only; HTTP 422 bodies carry
 * the redacted projection instead.
 */
export class ProfileParseError extends Error {
  readonly statusCode = 422;
  readonly code = 'PROFILE_PARSE_ERROR';
  // Not a constructor parameter property: those don't survive Node's
  // strip-only TS (same reason TS enums are banned repo-wide).
  readonly issues: ParseIssue[];

  constructor(issues: ParseIssue[]) {
    super(issues.map((issue) => `${issue.file}:${issue.line} — ${issue.message}`).join('\n'));
    this.name = 'ProfileParseError';
    this.issues = issues;
  }
}
