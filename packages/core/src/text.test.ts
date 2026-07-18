import { describe, expect, it } from 'vitest';

import {
  normalizeForMatching,
  normalizeWhitespace,
  tokenizeForMatching,
  verifyQuotes,
} from './text.ts';

// All fixtures fictional (RISKS P-01). The posting text below exists only for
// these tests. Every non-ASCII fixture character is a visible \uXXXX escape
// in this source (single backslash = the real character at runtime); the
// escape-TEXT fixture further down uses a double backslash on purpose.
const POSTING = [
  'Fictional Zenith Robotics is hiring a Senior Widget Engineer.',
  'Requirements:',
  '- 5+ years of TypeScript experience',
  '- Familiarity   with\tcontainer orchestration',
  'We value Zenith\u2019s culture of candid feedback.',
  'Compensation aligns with market rates.',
].join('\n');

describe('normalizeWhitespace', () => {
  // Moved from apps/api content-hash.test.ts at the M1-06 hoist — semantics
  // must not drift, the posting hash depends on them.
  it('collapses whitespace runs and trims the ends', () => {
    expect(normalizeWhitespace('  Senior\tEngineer\r\n\nRemote  ')).toBe('Senior Engineer Remote');
  });

  it('collapses Unicode space separators (NBSP) like ASCII space', () => {
    expect(normalizeWhitespace('Senior\u00A0Engineer')).toBe('Senior Engineer');
  });

  it('preserves zero-width characters (not \\s — they survive normalization)', () => {
    expect(normalizeWhitespace('Wid\u200Bget')).toBe('Wid\u200Bget');
  });
});

describe('verifyQuotes', () => {
  // The story's table: exact match, whitespace variance, fabricated quote,
  // near-miss paraphrase — plus the documented residuals and designed catches.
  it.each([
    {
      name: 'exact verbatim substring verifies',
      quote: '5+ years of TypeScript experience',
      expected: true,
    },
    {
      name: 'whitespace variance verifies (CRLF, tabs, runs, padding all collapse)',
      quote: '  Familiarity with\r\ncontainer   orchestration ',
      expected: true,
    },
    {
      name: 'NBSP in the quote verifies against a plain space in the posting',
      quote: '5+ years\u00A0of TypeScript experience',
      expected: true,
    },
    {
      name: 'quote spanning a posting line break verifies (newline collapses to space)',
      quote: 'Senior Widget Engineer. Requirements:',
      expected: true,
    },
    {
      name: 'fabricated quote flags (text absent from the posting)',
      quote: 'must hold a PhD in widget science',
      expected: false,
    },
    {
      name: 'near-miss paraphrase flags (must flag)',
      quote: 'at least five years of TypeScript',
      expected: false,
    },
    {
      name: 'case-only difference flags (documented residual)',
      quote: '5+ years of typescript experience',
      expected: false,
    },
    {
      name: 'typographic substitution flags — straight apostrophe vs the posting curly one (documented residual, the likeliest legitimate flag source)',
      quote: "Zenith's culture of candid feedback",
      expected: false,
    },
    {
      // The designed-catch analog for the one real stored quote: six characters
      // of escape TEXT (backslash, u, 2, 0, 1, 9 — double backslash in this
      // source) where the posting has the real character.
      name: 'literal backslash-u-2019 escape TEXT flags against the real character',
      quote: 'Zenith\\u2019s culture of candid feedback',
      expected: false,
    },
    {
      name: 'quote normalizing to empty flags (a quote that says nothing verifies nothing)',
      quote: ' \n\t ',
      expected: false,
    },
    {
      name: 'empty quote flags',
      quote: '',
      expected: false,
    },
    {
      name: 'quote longer than the posting flags',
      quote: `${POSTING} and then some`,
      expected: false,
    },
    {
      name: 'zero-width space in the quote flags (invisible-character divergence, unicode-smuggling-adjacent)',
      quote: '5+ years of Type\u200BScript experience',
      expected: false,
    },
  ])('$name', ({ quote, expected }) => {
    expect(verifyQuotes(POSTING, [quote])).toEqual([expected]);
  });

  it('verifies quotes independently — duplicates both verify, order preserved', () => {
    expect(verifyQuotes(POSTING, ['Requirements:', 'fabricated line', 'Requirements:'])).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('returns an empty array for no quotes', () => {
    expect(verifyQuotes(POSTING, [])).toEqual([]);
  });
});

// M1-09 A5: the MATCHING normalizer is a separate function — these tests also
// stand guard that adding it changed nothing above (verifyQuotes stays
// case-sensitive and punctuation-preserving by contract).
describe('normalizeForMatching / tokenizeForMatching', () => {
  it.each([
    ['lowercases', 'PostgreSQL', 'postgresql'],
    ['punctuation becomes space', 'Node.js', 'node js'],
    ['underscores become space (slug form)', 'node_js', 'node js'],
    ['mixed punctuation and digits', 'Vue.js 3', 'vue js 3'],
    ['whitespace collapses and trims', '  event -  driven  ', 'event driven'],
    ['empty input stays empty', '', ''],
    ['punctuation-only input becomes empty', '+++', ''],
  ])('%s', (_name, input, expected) => {
    expect(normalizeForMatching(input)).toBe(expected);
  });

  it('tokenizes to words, never [""]', () => {
    expect(tokenizeForMatching('Node.js and Vue 3')).toEqual(['node', 'js', 'and', 'vue', '3']);
    expect(tokenizeForMatching('')).toEqual([]);
    expect(tokenizeForMatching('...')).toEqual([]);
  });

  it('does not touch verifyQuotes semantics: case still flags there', () => {
    expect(verifyQuotes(POSTING, ['5+ YEARS of TypeScript experience'])).toEqual([false]);
  });
});
