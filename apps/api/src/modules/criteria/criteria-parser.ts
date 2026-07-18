// Pure markdown/YAML → structured-criteria parsing (no I/O, no SQL). The
// format contract is docs/profile.example/job-criteria.md: five fenced
// ```yaml blocks (exclude_when, increase_score_for, decrease_score_for,
// force_lowest_priority, comp_bounds), identified by their top-level keys —
// headings and prose are never parsed, so names and narrative stay
// human-only. Every deviation becomes a ParseIssue with file + line
// (M0-08 philosophy: nothing is silently skipped, nothing is invented).
// Validation is the packages/core criteria zod set — the same schemas that
// type the DB columns and the PUT /criteria body.
import { LineCounter, isMap, isScalar, parseDocument, type Document } from 'yaml';
import {
  compBoundsSchema,
  forceLowestPrioritySchema,
  hardFiltersSchema,
  negativeSignalsSchema,
  positiveSignalsSchema,
  type SearchCriteriaData,
} from '@careerforge/core';
import { type z } from 'zod';

import { type ParseIssue } from '../profile/parse-errors.ts';
import { type SourceFile } from '../profile/profile-parser.ts';

export const CRITERIA_BLOCKS = [
  'exclude_when',
  'increase_score_for',
  'decrease_score_for',
  'force_lowest_priority',
  'comp_bounds',
] as const;
export type CriteriaBlock = (typeof CRITERIA_BLOCKS)[number];

const isCriteriaBlock = (key: string): key is CriteriaBlock =>
  (CRITERIA_BLOCKS as readonly string[]).includes(key);

// C0 control bytes minus tab/LF/CR (plus DEL). Postgres text/jsonb rejects
// U+0000 outright and the rest are never legitimate criteria content — reject
// at the boundary with a value-free message (M1-05/M1-07 NUL discipline).
// eslint-disable-next-line no-control-regex
const CONTROL_BYTES = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

interface FencedYamlBlock {
  /** 1-based file line of the opening ``` fence. */
  fenceLine: number;
  /** 1-based file line where the YAML content starts. */
  contentLine: number;
  content: string;
}

function extractYamlBlocks(content: string): FencedYamlBlock[] {
  const lines = content.split('\n');
  const blocks: FencedYamlBlock[] = [];
  let open: { yaml: boolean; fenceLine: number; buffer: string[] } | null = null;
  for (const [index, line] of lines.entries()) {
    const fence = /^```(\S*)\s*$/.exec(line);
    if (!fence) {
      open?.buffer.push(line);
      continue;
    }
    if (open === null) {
      open = { yaml: fence[1] === 'yaml', fenceLine: index + 1, buffer: [] };
    } else {
      if (open.yaml) {
        blocks.push({
          fenceLine: open.fenceLine,
          contentLine: open.fenceLine + 1,
          content: open.buffer.join('\n'),
        });
      }
      open = null;
    }
  }
  return blocks;
}

interface Section {
  block: FencedYamlBlock;
  doc: Document;
  lineCounter: LineCounter;
  /** The top-level key's parsed plain-JS value. */
  value: unknown;
}

/** File line of the YAML node at [blockKey, ...path], walking shorter
 *  prefixes when a leaf has no node (e.g. a zod issue on a missing key). */
function lineForPath(section: Section, blockKey: string, path: (string | number)[]): number {
  for (let take = path.length; take >= 0; take--) {
    const node: unknown = section.doc.getIn([blockKey, ...path.slice(0, take)], true);
    const range =
      node !== null && typeof node === 'object' && 'range' in node
        ? (node as { range: [number, number, number] | null }).range
        : null;
    if (range) {
      return section.block.contentLine + section.lineCounter.linePos(range[0]).line - 1;
    }
  }
  return section.block.fenceLine;
}

function pushZodIssues(
  issues: ParseIssue[],
  file: string,
  section: Section,
  blockKey: CriteriaBlock,
  error: z.ZodError,
  lineOverrides?: Map<string, number>,
): void {
  for (const zodIssue of error.issues) {
    const line =
      (typeof zodIssue.path[0] === 'string' ? lineOverrides?.get(zodIssue.path[0]) : undefined) ??
      lineForPath(section, blockKey, zodIssue.path as (string | number)[]);
    issues.push({
      file,
      line,
      field: [blockKey, ...zodIssue.path].join('.'),
      rule: 'invalid-value',
      message: zodIssue.message,
    });
  }
}

/**
 * `exclude_when` arrives as a YAML LIST of single-key (or few-key) maps and
 * is normalized to ONE record before validation — the canonical hardFilters
 * shape. Duplicate keys across entries are an error, never a silent merge.
 * Returns the merged record plus each key's source line for issue anchoring.
 */
function normalizeExcludeWhen(
  section: Section,
  file: string,
  issues: ParseIssue[],
): { merged: Record<string, unknown>; lineByKey: Map<string, number> } {
  const merged: Record<string, unknown> = {};
  const lineByKey = new Map<string, number>();
  if (!Array.isArray(section.value)) {
    issues.push({
      file,
      line: lineForPath(section, 'exclude_when', []),
      field: 'exclude_when',
      rule: 'invalid-value',
      message: 'exclude_when must be a YAML list of filter entries',
    });
    return { merged, lineByKey };
  }
  section.value.forEach((entry: unknown, index) => {
    const line = lineForPath(section, 'exclude_when', [index]);
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push({
        file,
        line,
        field: `exclude_when.${index}`,
        rule: 'invalid-value',
        message: 'each exclude_when entry must be a `filter: value` map',
      });
      return;
    }
    for (const [key, value] of Object.entries(entry)) {
      if (key in merged) {
        issues.push({
          file,
          line,
          field: `exclude_when.${key}`,
          rule: 'duplicate-entry',
          message: `filter \`${key}\` appears more than once in exclude_when`,
        });
        continue;
      }
      merged[key] = value;
      lineByKey.set(key, line);
    }
  });
  return { merged, lineByKey };
}

/**
 * `force_lowest_priority` arrives as a YAML LIST of `- category: slug` maps
 * (possibly empty) and is normalized to `{ category: [slugs] }`. The
 * canonical `industry` list is always present; unknown categories survive
 * normalization so the STRICT zod schema rejects them with a named path —
 * one validation source, no parser-side allowlist to drift.
 */
function normalizeForceLowestPriority(
  section: Section,
  file: string,
  issues: ParseIssue[],
): Record<string, unknown> {
  const record: Record<string, unknown[]> = { industry: [] };
  if (!Array.isArray(section.value)) {
    issues.push({
      file,
      line: lineForPath(section, 'force_lowest_priority', []),
      field: 'force_lowest_priority',
      rule: 'invalid-value',
      message: 'force_lowest_priority must be a YAML list (it may be empty)',
    });
    return record;
  }
  section.value.forEach((entry: unknown, index) => {
    const line = lineForPath(section, 'force_lowest_priority', [index]);
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push({
        file,
        line,
        field: `force_lowest_priority.${index}`,
        rule: 'invalid-value',
        message: 'each force_lowest_priority entry must be a `category: slug` map',
      });
      return;
    }
    for (const [key, value] of Object.entries(entry)) {
      if (typeof value !== 'string') {
        issues.push({
          file,
          line,
          field: `force_lowest_priority.${key}`,
          rule: 'invalid-value',
          message: 'expected a single slug per force_lowest_priority entry',
        });
        continue;
      }
      (record[key] ??= []).push(value);
    }
  });
  return record;
}

/**
 * Parses one job-criteria source into the canonical SearchCriteriaData.
 * Pushes every problem onto `issues` (aggregate-everything contract — the
 * caller decides when to throw) and returns the data only when this source
 * contributed zero issues. Issue messages may quote criteria content and are
 * therefore CLI-stderr-only (RISKS P-01) — HTTP surfaces get the redacted
 * projection, like every profile parse issue.
 */
export function parseCriteria(
  source: SourceFile,
  issues: ParseIssue[],
): SearchCriteriaData | undefined {
  const before = issues.length;
  const file = source.name;

  // Control bytes fail fast with a value-free message: line numbers only.
  source.content.split('\n').forEach((line, index) => {
    if (CONTROL_BYTES.test(line)) {
      issues.push({
        file,
        line: index + 1,
        field: 'content',
        rule: 'invalid-value',
        message: 'line contains a control byte (C0/DEL) — criteria sources must be plain text',
      });
    }
  });
  if (issues.length > before) return undefined;

  const sections = new Map<CriteriaBlock, Section>();
  for (const block of extractYamlBlocks(source.content)) {
    const lineCounter = new LineCounter();
    const doc = parseDocument(block.content, { lineCounter });
    if (doc.errors.length > 0) {
      for (const error of doc.errors) {
        issues.push({
          file,
          line: block.contentLine + (error.linePos?.[0]?.line ?? 1) - 1,
          field: 'yaml',
          rule: 'invalid-value',
          message: error.message.split('\n')[0] ?? 'YAML syntax error',
        });
      }
      continue;
    }
    if (!isMap(doc.contents)) {
      issues.push({
        file,
        line: block.fenceLine,
        field: 'yaml',
        rule: 'invalid-value',
        message: 'expected a YAML mapping with a criteria block key at the top level',
      });
      continue;
    }
    const parsed: unknown = doc.toJS();
    for (const pair of doc.contents.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      const keyLine =
        block.contentLine +
        (isScalar(pair.key) && pair.key.range
          ? lineCounter.linePos(pair.key.range[0]).line - 1
          : 0);
      if (!isCriteriaBlock(key)) {
        issues.push({
          file,
          line: keyLine,
          field: key || 'yaml',
          rule: 'invalid-value',
          message: `unknown criteria block \`${key}\` — expected one of: ${CRITERIA_BLOCKS.join(', ')}`,
        });
        continue;
      }
      if (sections.has(key)) {
        issues.push({
          file,
          line: keyLine,
          field: key,
          rule: 'duplicate-entry',
          message: `criteria block \`${key}\` appears more than once`,
        });
        continue;
      }
      sections.set(key, {
        block,
        doc,
        lineCounter,
        value: (parsed as Record<string, unknown>)[key],
      });
    }
  }

  for (const required of CRITERIA_BLOCKS) {
    if (!sections.has(required)) {
      issues.push({
        file,
        line: 1,
        field: required,
        rule: 'missing-section',
        message: `missing \`${required}\` YAML block (all five criteria blocks are required)`,
      });
    }
  }
  if (issues.length > before) return undefined;

  // When a block's normalization already errored, its zod pass is skipped —
  // validating a half-normalized value would only add noise on top of the
  // real problem (the profile parser's link-error suppression, same idea).
  const excludeWhen = sections.get('exclude_when')!;
  const beforeExclude = issues.length;
  const { merged: hardFiltersRaw, lineByKey } = normalizeExcludeWhen(excludeWhen, file, issues);
  const hardFilters =
    issues.length === beforeExclude ? hardFiltersSchema.safeParse(hardFiltersRaw) : undefined;
  if (hardFilters && !hardFilters.success) {
    pushZodIssues(issues, file, excludeWhen, 'exclude_when', hardFilters.error, lineByKey);
  }

  const increase = sections.get('increase_score_for')!;
  const positiveSignals = positiveSignalsSchema.safeParse(increase.value);
  if (!positiveSignals.success) {
    pushZodIssues(issues, file, increase, 'increase_score_for', positiveSignals.error);
  }

  const decrease = sections.get('decrease_score_for')!;
  const negativeSignals = negativeSignalsSchema.safeParse(decrease.value);
  if (!negativeSignals.success) {
    pushZodIssues(issues, file, decrease, 'decrease_score_for', negativeSignals.error);
  }

  const forceLowest = sections.get('force_lowest_priority')!;
  const beforeForce = issues.length;
  const forceLowestRaw = normalizeForceLowestPriority(forceLowest, file, issues);
  const forceLowestPriority =
    issues.length === beforeForce ? forceLowestPrioritySchema.safeParse(forceLowestRaw) : undefined;
  if (forceLowestPriority && !forceLowestPriority.success) {
    pushZodIssues(issues, file, forceLowest, 'force_lowest_priority', forceLowestPriority.error);
  }

  const comp = sections.get('comp_bounds')!;
  const compBounds = compBoundsSchema.safeParse(comp.value);
  if (!compBounds.success) {
    pushZodIssues(issues, file, comp, 'comp_bounds', compBounds.error);
  }

  if (
    issues.length > before ||
    !hardFilters?.success ||
    !positiveSignals.success ||
    !negativeSignals.success ||
    !forceLowestPriority?.success ||
    !compBounds.success
  ) {
    return undefined;
  }
  return {
    hardFilters: hardFilters.data,
    positiveSignals: positiveSignals.data,
    negativeSignals: negativeSignals.data,
    forceLowestPriority: forceLowestPriority.data,
    compBounds: compBounds.data,
  };
}
