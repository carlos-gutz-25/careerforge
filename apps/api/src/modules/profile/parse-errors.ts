/** One actionable problem in a profile source file — never a silent skip. */
export interface ParseIssue {
  /** Source file name relative to the profile directory (e.g. "skills.md"). */
  file: string;
  /** 1-based line the problem anchors to. */
  line: number;
  message: string;
}

/**
 * Aggregate of every issue found across the profile sources, so one import
 * attempt surfaces all fixes at once. Issue messages can quote profile
 * content — callers must keep them out of pino logs (RISKS P-01) and surface
 * them only in the HTTP response body / CLI stderr.
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
