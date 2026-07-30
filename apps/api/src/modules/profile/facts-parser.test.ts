import { describe, expect, it } from 'vitest';

import { parseFacts } from './facts-parser.ts';
import { type ParseIssue } from './parse-errors.ts';
import { type SourceFile } from './profile-parser.ts';

// M12-03: the facts.md parser. Pure (no I/O). All fictional (RISKS P-01),
// ASCII-only. The block-fence + line-anchoring machinery mirrors criteria-parser.

const source = (content: string): SourceFile => ({ name: 'facts.md', content });

const yamlBlock = (body: string): string => ['# Facts', '', '```yaml', body, '```', ''].join('\n');

describe('parseFacts', () => {
  it('parses a valid facts block into ProfileFactImport rows', () => {
    const issues: ParseIssue[] = [];
    const facts = parseFacts(
      source(
        yamlBlock(
          [
            'facts:',
            '  work_authorization:',
            '    value: "Authorized to work in the US"',
            '    declared: 2026-01-15',
            '  visa_sponsorship_needed:',
            '    value: "no"',
            '    declared: 2026-01-15',
            '  relocation_stance:',
            '    value: open_for_right_opportunity',
            '    declared: 2026-01-15',
            '    note: "Would relocate for a strong role"',
          ].join('\n'),
        ),
      ),
      issues,
    );
    expect(issues).toEqual([]);
    expect(facts).toBeDefined();
    expect(facts).toHaveLength(3);
    const workAuth = facts?.find((f) => f.kind === 'work_authorization');
    expect(workAuth?.value).toBe('Authorized to work in the US');
    expect(workAuth?.declaredAt).toBe('2026-01-15');
    expect(workAuth?.note).toBeNull();
    expect(facts?.find((f) => f.kind === 'relocation_stance')?.note).toBe(
      'Would relocate for a strong role',
    );
  });

  it('a file with no facts block is valid and yields [] (facts are optional)', () => {
    const issues: ParseIssue[] = [];
    expect(parseFacts(source('# Facts\n\nNothing declared yet.\n'), issues)).toEqual([]);
    expect(issues).toEqual([]);
  });

  it('an empty facts: block yields []', () => {
    const issues: ParseIssue[] = [];
    expect(parseFacts(source(yamlBlock('facts:')), issues)).toEqual([]);
    expect(issues).toEqual([]);
  });

  it('rejects an unknown fact kind with a file:line issue', () => {
    const issues: ParseIssue[] = [];
    const result = parseFacts(
      source(
        yamlBlock(
          ['facts:', '  favorite_color:', '    value: blue', '    declared: 2026-01-15'].join('\n'),
        ),
      ),
      issues,
    );
    expect(result).toBeUndefined();
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.file).toBe('facts.md');
    expect(issues[0]?.field).toContain('favorite_color');
    expect(issues[0]?.line).toBeGreaterThan(0);
  });

  it('rejects an out-of-vocabulary stance value (per-kind, via the core schema)', () => {
    const issues: ParseIssue[] = [];
    const result = parseFacts(
      source(
        yamlBlock(
          ['facts:', '  relocation_stance:', '    value: maybe', '    declared: 2026-01-15'].join(
            '\n',
          ),
        ),
      ),
      issues,
    );
    expect(result).toBeUndefined();
    expect(issues.some((issue) => issue.field.includes('relocation_stance'))).toBe(true);
  });

  it('rejects a malformed declared date', () => {
    const issues: ParseIssue[] = [];
    const result = parseFacts(
      source(
        yamlBlock(
          [
            'facts:',
            '  availability_notice:',
            '    value: "Two weeks"',
            '    declared: someday',
          ].join('\n'),
        ),
      ),
      issues,
    );
    expect(result).toBeUndefined();
    expect(issues.some((issue) => issue.field.includes('availability_notice'))).toBe(true);
  });

  it('rejects a non-scalar note (a nested map) rather than silently nulling it', () => {
    const issues: ParseIssue[] = [];
    const result = parseFacts(
      source(
        yamlBlock(
          [
            'facts:',
            '  availability_notice:',
            '    value: "Two weeks"',
            '    declared: 2026-01-15',
            '    note:',
            '      nested: oops',
          ].join('\n'),
        ),
      ),
      issues,
    );
    expect(result).toBeUndefined();
    expect(issues.some((issue) => issue.field.includes('note'))).toBe(true);
  });

  it('flags a control byte with a value-free message', () => {
    const issues: ParseIssue[] = [];
    const result = parseFacts(source(yamlBlock(`facts:${String.fromCharCode(0)}`)), issues);
    expect(result).toBeUndefined();
    expect(issues[0]?.message).toContain('control byte');
  });
});
