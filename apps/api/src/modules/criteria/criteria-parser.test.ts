import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { type ParseIssue } from '../profile/parse-errors.ts';
import { CRITERIA_BLOCKS, parseCriteria, type CriteriaBlock } from './criteria-parser.ts';

// All fixture values are FICTIONAL (docs/profile.example/ vocabulary).
// Invisible characters appear only as visible \uXXXX escapes in this source.

const DEFAULT_BLOCKS: Record<CriteriaBlock, string> = {
  exclude_when: [
    'exclude_when:',
    '  - base_salary_max_is_known_and_below: 120000',
    '  - compensation_type: equity_only',
    '  - employment_type:',
    '      - unpaid',
    '      - internship',
    '  - industry:',
    '      - gambling',
    '  - seniority:',
    '      - entry_level',
    '      - junior',
    '  - onsite_requirement:',
    '      outside_springfield_metro: true # onsite in-metro is fine',
    '      without_relocation_support: true',
    '  - primary_function:',
    '      - qa_only',
    '      - project_management_only',
  ].join('\n'),
  increase_score_for: [
    'increase_score_for:',
    '  role:',
    '    - senior_software_engineer',
    '  technologies:',
    '    - typescript',
    '  problem_domains:',
    '    - api_platforms',
    '    - payments_and_fintech',
    '  work_arrangement:',
    '    - remote_us',
    '  scope:',
    '    - architecture',
  ].join('\n'),
  decrease_score_for: ['decrease_score_for:', '  - frontend_only', '  - unclear_salary'].join('\n'),
  force_lowest_priority: [
    '# Not excluded, only ranked at the bottom.',
    'force_lowest_priority:',
    '  - industry: multilevel_marketing',
  ].join('\n'),
  comp_bounds: [
    'comp_bounds:',
    '  currency: usd',
    '  base_preferred_min: 150000',
    '  base_preferred_max: 190000',
    '  total_preferred_min: 165000',
    '  total_preferred_max: 230000',
  ].join('\n'),
};

/** A fictional criteria document; override a block's YAML or set it to null
 *  to omit it. `extraBlocks` are appended as additional yaml fences. */
function buildDoc(
  overrides: Partial<Record<CriteriaBlock, string | null>> = {},
  extraBlocks: string[] = [],
): string {
  const parts = [
    '# Job Criteria (fictional example)',
    '',
    'Prose is never parsed. Candidate: Jordan Example.',
    '',
  ];
  for (const block of CRITERIA_BLOCKS) {
    const body = overrides[block] === undefined ? DEFAULT_BLOCKS[block] : overrides[block];
    if (body === null) continue;
    parts.push('```yaml', body, '```', '');
  }
  for (const extra of extraBlocks) parts.push('```yaml', extra, '```', '');
  return parts.join('\n');
}

function parse(content: string) {
  const issues: ParseIssue[] = [];
  const data = parseCriteria({ name: 'job-criteria.md', content }, issues);
  return { issues, data };
}

describe('criteria parser', () => {
  it('parses the full fictional document into canonical shapes', () => {
    const { issues, data } = parse(buildDoc());
    expect(issues).toEqual([]);
    expect(data).toEqual({
      hardFilters: {
        base_salary_max_is_known_and_below: 120_000,
        compensation_type: 'equity_only',
        employment_type: ['unpaid', 'internship'],
        industry: ['gambling'],
        seniority: ['entry_level', 'junior'],
        onsite_requirement: {
          outside_springfield_metro: true,
          without_relocation_support: true,
        },
        primary_function: ['qa_only', 'project_management_only'],
      },
      positiveSignals: {
        role: ['senior_software_engineer'],
        technologies: ['typescript'],
        problem_domains: ['api_platforms', 'payments_and_fintech'],
        work_arrangement: ['remote_us'],
        scope: ['architecture'],
      },
      negativeSignals: ['frontend_only', 'unclear_salary'],
      forceLowestPriority: { industry: ['multilevel_marketing'] },
      compBounds: {
        currency: 'usd',
        base_preferred_min: 150_000,
        base_preferred_max: 190_000,
        total_preferred_min: 165_000,
        total_preferred_max: 230_000,
      },
    });
  });

  it('never parses prose or headings — narrative content cannot reach the output', () => {
    const { issues, data } = parse(buildDoc());
    expect(issues).toEqual([]);
    expect(JSON.stringify(data)).not.toContain('Jordan');
  });

  it('exclude_when without an industry key is valid (the key is optional)', () => {
    const withoutIndustry = DEFAULT_BLOCKS.exclude_when
      .split('\n')
      .filter((line) => !line.includes('industry') && !line.includes('gambling'))
      .join('\n');
    const { issues, data } = parse(buildDoc({ exclude_when: withoutIndustry }));
    expect(issues).toEqual([]);
    expect(data?.hardFilters.industry).toBeUndefined();
  });

  it('comp_bounds without the total pair is valid (pair is optional together)', () => {
    const withoutTotals = DEFAULT_BLOCKS.comp_bounds
      .split('\n')
      .filter((line) => !line.includes('total_'))
      .join('\n');
    const { issues, data } = parse(buildDoc({ comp_bounds: withoutTotals }));
    expect(issues).toEqual([]);
    expect(data?.compBounds.total_preferred_min).toBeUndefined();
  });

  it('an empty force_lowest_priority list normalizes to { industry: [] }', () => {
    const { issues, data } = parse(
      buildDoc({ force_lowest_priority: 'force_lowest_priority: []' }),
    );
    expect(issues).toEqual([]);
    expect(data?.forceLowestPriority).toEqual({ industry: [] });
  });

  describe('issue classes (every deviation is a located ParseIssue)', () => {
    it('a missing block is missing-section — all five are required', () => {
      const { issues, data } = parse(buildDoc({ comp_bounds: null }));
      expect(data).toBeUndefined();
      expect(issues).toMatchObject([
        { file: 'job-criteria.md', field: 'comp_bounds', rule: 'missing-section' },
      ]);
    });

    it('a repeated block is duplicate-entry', () => {
      const { issues, data } = parse(
        buildDoc({}, ['decrease_score_for:\n  - short_term_contract']),
      );
      expect(data).toBeUndefined();
      expect(issues).toMatchObject([{ field: 'decrease_score_for', rule: 'duplicate-entry' }]);
    });

    it('an unknown top-level block key is invalid-value', () => {
      const { issues, data } = parse(buildDoc({}, ['mystery_block:\n  - something']));
      expect(data).toBeUndefined();
      expect(issues).toMatchObject([{ field: 'mystery_block', rule: 'invalid-value' }]);
    });

    it('a duplicated filter inside exclude_when is duplicate-entry, never a silent merge', () => {
      const duplicated = `${DEFAULT_BLOCKS.exclude_when}\n  - seniority:\n      - junior`;
      const { issues, data } = parse(buildDoc({ exclude_when: duplicated }));
      expect(data).toBeUndefined();
      expect(issues).toMatchObject([{ field: 'exclude_when.seniority', rule: 'duplicate-entry' }]);
    });

    it('a non-map exclude_when entry is invalid-value', () => {
      const { issues, data } = parse(
        buildDoc({ exclude_when: 'exclude_when:\n  - just_a_bare_slug' }),
      );
      expect(data).toBeUndefined();
      expect(issues).toMatchObject([{ field: 'exclude_when.0', rule: 'invalid-value' }]);
    });

    it('an onsite_requirement key outside the metro pattern is invalid-value', () => {
      const badKey = DEFAULT_BLOCKS.exclude_when.replace(
        'outside_springfield_metro',
        'anywhere_on_earth',
      );
      const { issues, data } = parse(buildDoc({ exclude_when: badKey }));
      expect(data).toBeUndefined();
      expect(issues.some((issue) => issue.field.includes('onsite_requirement'))).toBe(true);
      expect(issues.every((issue) => issue.rule === 'invalid-value')).toBe(true);
    });

    it('a non-slug signal is invalid-value with a path-bearing field', () => {
      const { issues, data } = parse(
        buildDoc({ decrease_score_for: 'decrease_score_for:\n  - Bad-Slug' }),
      );
      expect(data).toBeUndefined();
      expect(issues).toMatchObject([{ field: 'decrease_score_for.0', rule: 'invalid-value' }]);
    });

    it('an empty decrease_score_for list is invalid-value (min 1)', () => {
      const { issues, data } = parse(buildDoc({ decrease_score_for: 'decrease_score_for: []' }));
      expect(data).toBeUndefined();
      expect(issues).toMatchObject([{ field: 'decrease_score_for', rule: 'invalid-value' }]);
    });

    it('base_preferred_min above base_preferred_max is invalid-value', () => {
      const inverted = DEFAULT_BLOCKS.comp_bounds.replace(
        'base_preferred_min: 150000',
        'base_preferred_min: 200000',
      );
      const { issues, data } = parse(buildDoc({ comp_bounds: inverted }));
      expect(data).toBeUndefined();
      expect(issues).toMatchObject([
        { field: 'comp_bounds.base_preferred_min', rule: 'invalid-value' },
      ]);
    });

    it('half a total pair is invalid-value — the pair appears together', () => {
      const half = DEFAULT_BLOCKS.comp_bounds
        .split('\n')
        .filter((line) => !line.includes('total_preferred_max'))
        .join('\n');
      const { issues, data } = parse(buildDoc({ comp_bounds: half }));
      expect(data).toBeUndefined();
      expect(issues).toMatchObject([
        { field: 'comp_bounds.total_preferred_max', rule: 'invalid-value' },
      ]);
    });

    it('an unknown force_lowest_priority category is invalid-value (strict schema)', () => {
      const { issues, data } = parse(
        buildDoc({
          force_lowest_priority: 'force_lowest_priority:\n  - company: acme_fictional',
        }),
      );
      expect(data).toBeUndefined();
      expect(issues.some((issue) => issue.field.startsWith('force_lowest_priority'))).toBe(true);
    });

    it('a control byte fails fast with a value-free located issue (NUL discipline)', () => {
      const poisoned = buildDoc().replace('- typescript', '- type\u0000script');
      const { issues, data } = parse(poisoned);
      expect(data).toBeUndefined();
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ field: 'content', rule: 'invalid-value' });
      expect(issues[0]!.message).not.toContain('typescript'); // value-free
      expect(issues[0]!.line).toBe(
        buildDoc()
          .split('\n')
          .findIndex((line) => line.includes('- typescript')) + 1,
      );
    });

    it('a YAML syntax error is invalid-value at a real line', () => {
      const { issues, data } = parse(
        buildDoc({ exclude_when: 'exclude_when:\n  - seniority: [unclosed' }),
      );
      expect(data).toBeUndefined();
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toMatchObject({ rule: 'invalid-value' });
      expect(issues[0]!.line).toBeGreaterThan(0);
    });
  });

  describe('DOMAIN LAW — payments/fintech is a positive signal, structurally non-excludable', () => {
    const examplePath = fileURLToPath(
      new URL('../../../../../docs/profile.example/job-criteria.md', import.meta.url),
    );

    it('the committed example imports payments_and_fintech as a problem_domains POSITIVE signal', async () => {
      const content = await readFile(examplePath, 'utf8');
      const { issues, data } = parse(content);
      expect(issues).toEqual([]);
      expect(data?.positiveSignals.problem_domains).toContain('payments_and_fintech');
    });

    it('no payments/fintech token exists in ANY exclusion or cap path of the parsed example', async () => {
      const content = await readFile(examplePath, 'utf8');
      const { data } = parse(content);
      const exclusionAndCapJson =
        JSON.stringify(data?.hardFilters) + JSON.stringify(data?.forceLowestPriority);
      expect(exclusionAndCapJson).not.toMatch(/payments|fintech/);
    });

    it('smuggling problem_domains into exclude_when is a parse error (closed key set) — the historical fintech-as-dealbreaker misclassification cannot return as data', () => {
      const smuggled = `${DEFAULT_BLOCKS.exclude_when}\n  - problem_domains:\n      - payments_and_fintech`;
      const { issues, data } = parse(buildDoc({ exclude_when: smuggled }));
      expect(data).toBeUndefined();
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((issue) => issue.rule === 'invalid-value')).toBe(true);
      expect(issues.map((issue) => issue.message).join(' ')).toMatch(/problem_domains/);
    });

    it('the committed example carries the EXACT seed comp numbers (seed-example-import no-op triangle)', async () => {
      const content = await readFile(examplePath, 'utf8');
      const { data } = parse(content);
      expect(data?.compBounds).toEqual({
        currency: 'usd',
        base_preferred_min: 150_000,
        base_preferred_max: 190_000,
        total_preferred_min: 165_000,
        total_preferred_max: 230_000,
      });
    });
  });
});
