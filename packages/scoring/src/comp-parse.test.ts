import { describe, expect, it } from 'vitest';

import { parseCompRange } from './comp-parse.ts';

// D6: the comp recognizer is minimal and CONSERVATIVE — anything ambiguous is
// unknown, and unknown never fires a hard filter. All figures fictional.
describe('parseCompRange', () => {
  it.each([
    ['dollar range', 'Base salary $141,000 - $181,000 per year', { min: 141_000, max: 181_000 }],
    ['k range', 'comp band 141k-181k USD base', { min: 141_000, max: 181_000 }],
    ['dollar-k range', 'pays $141k to $181k', { min: 141_000, max: 181_000 }],
    ['single figure = point value', 'base pay of $156,500', { min: 156_500, max: 156_500 }],
    ['plain dollar digits', 'salary $156500 annually', { min: 156_500, max: 156_500 }],
    [
      'text paraphrase repeating the quote figures stays a range',
      'Base range $141,000 to $181,000. Base salary range: $141,000-$181,000.',
      { min: 141_000, max: 181_000 },
    ],
    ['no figures = unknown', 'competitive compensation with great benefits', undefined],
    ['three distinct figures = ambiguous = unknown', '$121k base, $151k OTE, $181k cap', undefined],
    ['descending pair = unknown', 'from $181,000 down to $141,000', undefined],
    ['hourly-scale figures are ignored', 'pays $85 per hour', undefined],
    ['equity share counts are ignored', '10,000,000 options outstanding', undefined],
    ['bare 401k is the retirement plan, not salary', '401k with match provided', undefined],
    ['bare digits without a money marker are ignored', 'team of 150000 users', undefined],
  ])('%s', (_name, text, expected) => {
    expect(parseCompRange(text)).toEqual(expected);
  });
});
