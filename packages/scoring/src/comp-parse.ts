// Minimal deterministic compensation recognizer (M1-09 D6): annual base
// figures only, from comp-category requirement text. Conservative by
// construction — anything ambiguous parses as UNKNOWN, and unknown never
// fires a hard filter. Runs on RAW text (the matching normalizer strips the
// `$`/`k` markers this parser keys on).

export interface CompRange {
  min: number;
  max: number;
}

/** Salary-plausible window: figures outside it are ignored (guards against
 *  hourly rates, equity share counts, employee counts). */
const PLAUSIBLE_MIN = 30_000;
const PLAUSIBLE_MAX = 1_500_000;

// Two accepted spellings, each requiring an explicit money marker:
//   $150,000 / $150000  (dollar sign, 5-7 digits or comma groups)
//   150k / $150k        (k suffix, 2-4 digits)
const DOLLAR_FIGURE = /\$\s*(\d{1,3}(?:,\d{3})+|\d{4,7})(?!\d|,\d)/g;
const K_FIGURE = /(?<![\w.])\$?\s*(\d{2,4}(?:\.\d)?)\s*k\b/gi;

/**
 * Extracts the base range iff the text is unambiguous: exactly one plausible
 * figure (a point value) or exactly two in non-descending order (a range).
 * Zero figures, three or more, or a descending pair -> undefined (unknown).
 */
export function parseCompRange(text: string): CompRange | undefined {
  const found: { index: number; value: number }[] = [];
  for (const match of text.matchAll(DOLLAR_FIGURE)) {
    found.push({ index: match.index, value: Number(match[1]!.replaceAll(',', '')) });
  }
  for (const match of text.matchAll(K_FIGURE)) {
    // "401k" without a dollar sign is the US retirement plan, not a salary.
    if (match[1] === '401' && !match[0].includes('$')) continue;
    found.push({ index: match.index, value: Number(match[1]!) * 1000 });
  }
  // Unique VALUES in first-occurrence order: a figure repeated verbatim (the
  // requirement's text often paraphrases the same numbers its quote carries)
  // is one figure, not an ambiguity.
  const values = [
    ...new Set(
      found
        .sort((a, b) => a.index - b.index)
        .map((entry) => entry.value)
        .filter((value) => value >= PLAUSIBLE_MIN && value <= PLAUSIBLE_MAX),
    ),
  ];

  if (values.length === 1) return { min: values[0]!, max: values[0]! };
  if (values.length === 2 && values[0]! <= values[1]!) return { min: values[0]!, max: values[1]! };
  return undefined;
}
