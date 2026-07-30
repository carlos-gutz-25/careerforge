// Pure markdown/YAML → durable-profile-facts parsing (M12-03, no I/O, no SQL).
// The format contract is docs/profile.example/facts.md: ONE fenced ```yaml block
// keyed `facts`, a mapping of fact-kind → { value, declared, note? }. Headings
// and prose are never parsed (names/narrative stay human-only). Every deviation
// becomes a ParseIssue with file + line (M0-08 philosophy; nothing silently
// skipped or invented). Validation is the packages/core profileFactImportSchema
// — the same value-vocabulary/NUL/date rules that back the DB and wire. Issue
// messages may quote fact content and are therefore CLI-stderr-only (RISKS
// P-01); HTTP surfaces get the redacted projection. Fact VALUES are a sensitive
// class and never enter logs.
//
// The embedded-YAML block extraction mirrors criteria-parser.ts (the house
// template); it is deliberately duplicated here so the two format parsers stay
// independent (each owns its contract).
import { LineCounter, isMap, isScalar, parseDocument, type Document } from 'yaml';
import { PROFILE_FACT_KINDS, profileFactImportSchema } from '@careerforge/core';
import { type ProfileFactImport } from '@careerforge/db';

import { type ParseIssue } from './parse-errors.ts';
import { type SourceFile } from './profile-parser.ts';

const FACTS_BLOCK_KEY = 'facts';

// C0 control bytes (minus tab/LF/CR) + DEL, as a char class built from codes so
// the SOURCE stays printable ASCII — no `\u` escape that could mangle into a raw
// byte (the Write-tool NUL hazard). U+0000 is ALSO caught by the core schema's
// value/note guards; this scan rejects any C0 byte anywhere in the file early.
const CONTROL_BYTES = new RegExp(
  `[${[
    0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
    29, 30, 31, 127,
  ]
    .map((code) => String.fromCharCode(code))
    .join('')}]`,
);

interface FencedYamlBlock {
  /** 1-based file line of the opening fence. */
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
  /** The `facts` key's parsed plain-JS value. */
  value: unknown;
}

/** File line of the YAML node at [facts, ...path], walking shorter prefixes when
 *  a leaf has no node (a zod issue on a missing sub-key). */
function lineForFacts(section: Section, path: (string | number)[]): number {
  for (let take = path.length; take >= 0; take--) {
    const node: unknown = section.doc.getIn([FACTS_BLOCK_KEY, ...path.slice(0, take)], true);
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

/**
 * Parse a facts.md source into the canonical ProfileFactImport list. Pushes
 * every problem onto `issues` (aggregate-everything — the caller decides when to
 * throw) and returns the facts only when this source contributed zero issues.
 * A file with no `facts` block (or an empty one) is VALID and yields [] — facts
 * are optional, and an absent/empty facts.md means "no declared facts" (the
 * full-sync then deletes any existing rows: the file is the source of truth).
 */
export function parseFacts(
  source: SourceFile,
  issues: ParseIssue[],
): ProfileFactImport[] | undefined {
  const before = issues.length;
  const file = source.name;

  // Control bytes fail fast with a value-free message (line numbers only).
  source.content.split('\n').forEach((line, index) => {
    if (CONTROL_BYTES.test(line)) {
      issues.push({
        file,
        line: index + 1,
        field: 'content',
        rule: 'invalid-value',
        message: 'line contains a control byte (C0/DEL) — facts sources must be plain text',
      });
    }
  });
  if (issues.length > before) return undefined;

  let section: Section | undefined;
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
        message: 'expected a YAML mapping with a `facts` block key at the top level',
      });
      continue;
    }
    const parsed = doc.toJS() as Record<string, unknown>;
    for (const pair of doc.contents.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      const keyLine =
        block.contentLine +
        (isScalar(pair.key) && pair.key.range
          ? lineCounter.linePos(pair.key.range[0]).line - 1
          : 0);
      if (key !== FACTS_BLOCK_KEY) {
        issues.push({
          file,
          line: keyLine,
          field: key || 'yaml',
          rule: 'invalid-value',
          message: `unknown block \`${key}\` — the only facts block key is \`${FACTS_BLOCK_KEY}\``,
        });
        continue;
      }
      if (section) {
        issues.push({
          file,
          line: keyLine,
          field: FACTS_BLOCK_KEY,
          rule: 'duplicate-entry',
          message: '`facts` block appears more than once',
        });
        continue;
      }
      section = { block, doc, lineCounter, value: parsed[FACTS_BLOCK_KEY] };
    }
  }

  if (issues.length > before) return undefined;
  // No `facts` block, or `facts:` present but empty → zero declared facts.
  if (section === undefined || section.value === null || section.value === undefined) {
    return [];
  }
  if (typeof section.value !== 'object' || Array.isArray(section.value)) {
    issues.push({
      file,
      line: lineForFacts(section, []),
      field: FACTS_BLOCK_KEY,
      rule: 'invalid-value',
      message: '`facts` must be a mapping of fact-kind → { value, declared, note? }',
    });
    return undefined;
  }

  const results: ProfileFactImport[] = [];
  for (const [kind, entry] of Object.entries(section.value as Record<string, unknown>)) {
    const line = lineForFacts(section, [kind]);
    if (!(PROFILE_FACT_KINDS as readonly string[]).includes(kind)) {
      issues.push({
        file,
        line,
        field: `facts.${kind}`,
        rule: 'invalid-value',
        message: `unknown fact kind \`${kind}\` — expected one of: ${PROFILE_FACT_KINDS.join(', ')}`,
      });
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push({
        file,
        line,
        field: `facts.${kind}`,
        rule: 'invalid-value',
        message: 'each fact must be a `value: ...` map (optional `note`, and a `declared` date)',
      });
      continue;
    }
    const fields = entry as Record<string, unknown>;
    // A present-but-non-scalar note (a nested map/list) is a malformed note, not
    // a silent null - flag it (nothing silently skipped, the file's contract).
    let note: string | null = null;
    if (fields.note !== undefined && fields.note !== null) {
      const noteText = scalarString(fields.note);
      if (noteText === undefined) {
        issues.push({
          file,
          line,
          field: `facts.${kind}.note`,
          rule: 'invalid-value',
          message: 'note must be a text value',
        });
        continue;
      }
      note = noteText;
    }
    const raw = {
      kind,
      value: scalarString(fields.value),
      note,
      declaredAt: scalarString(fields.declared),
    };
    const parsed = profileFactImportSchema.safeParse(raw);
    if (!parsed.success) {
      for (const zodIssue of parsed.error.issues) {
        const first = zodIssue.path[0];
        const fieldName = first === 'declaredAt' ? 'declared' : String(first ?? '');
        issues.push({
          file,
          line,
          field: `facts.${kind}${fieldName ? `.${fieldName}` : ''}`,
          rule: 'invalid-value',
          message: zodIssue.message,
        });
      }
      continue;
    }
    results.push(parsed.data);
  }

  if (issues.length > before) return undefined;
  return results;
}

/** A YAML scalar as a string (numbers/booleans stringified). Non-scalars (a
 *  nested map/list) and undefined yield undefined, so the schema reports the
 *  missing/invalid field rather than an '[object Object]' string. */
function scalarString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}
