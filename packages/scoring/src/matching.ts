import { tokenizeForMatching } from '@careerforge/core';

// Deterministic vocabulary matching (M1-09). Slugs and profile phrases match
// TEXT through the core matching normalizer (A5) and the one primitive below —
// every match in the engine goes through this file, so the matching semantics
// have exactly one definition. Alias/synonym matching (e.g. "TS" for
// typescript) is deliberately absent (A5 — a recorded future item, not an
// oversight).

/**
 * Token-subsequence phrase match: every phrase token appears in the haystack
 * in order, with at most `maxGap` intervening tokens between consecutive
 * phrase tokens (so `vue 3` meets "Vue.js 3" — one intervening token — but
 * `vue 3` does not meet "vue" ... twenty words ... "3"). The default gap of 2
 * is the MATCHING posture; exclusion evaluators pass 0 (strict adjacency —
 * conservative-evidence law D6 wants exact phrases before excluding).
 * An empty phrase matches nothing.
 */
export function phraseMatches(
  haystack: readonly string[],
  phrase: readonly string[],
  maxGap = 2,
): boolean {
  if (phrase.length === 0) return false;
  const first = phrase[0]!;
  for (let start = 0; start < haystack.length; start += 1) {
    if (haystack[start] !== first) continue;
    let at = start;
    let matched = 1;
    while (matched < phrase.length) {
      const limit = Math.min(at + 1 + maxGap, haystack.length - 1);
      let found = -1;
      for (let next = at + 1; next <= limit; next += 1) {
        if (haystack[next] === phrase[matched]) {
          found = next;
          break;
        }
      }
      if (found === -1) break;
      at = found;
      matched += 1;
    }
    if (matched === phrase.length) return true;
  }
  return false;
}

/** Does free text contain the slug's phrase? (`node_js` meets "Node.js".) */
export function textMatchesPhrase(text: string, phrase: string, maxGap = 2): boolean {
  return phraseMatches(tokenizeForMatching(text), tokenizeForMatching(phrase), maxGap);
}

/** Round to 4 decimals: one rounding rule for every score and ratio, so
 *  deep-equality across runs is exact (float noise never enters reports). */
export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
