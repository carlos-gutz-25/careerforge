import { describe, expect, it } from 'vitest';

import { clamp01, mean, phraseMatches, round4, textMatchesPhrase } from './matching.ts';

describe('textMatchesPhrase — the A5 named cases', () => {
  it.each([
    ['node_js meets "Node.js"', 'Node.js', 'node_js', true],
    ['vue_3 meets "Vue 3"', 'Vue 3', 'vue_3', true],
    ['vue_3 meets "Vue.js 3" (one intervening token)', 'Vue.js 3', 'vue_3', true],
    ['postgresql meets "PostgreSQL"', 'PostgreSQL', 'postgresql', true],
    // Alias/synonym matching is OUT of scope by decision (A5).
    ['typescript does NOT meet "TS"', 'TS', 'typescript', false],
    // Tokens are exact: no substring creep.
    ['contract does NOT meet "contractor"', 'contractor obligations', 'contract', false],
    ['java does NOT meet "javascript"', 'javascript', 'java', false],
    ['case never matters', 'TYPESCRIPT and node', 'typescript', true],
  ])('%s', (_name, text, phrase, expected) => {
    expect(textMatchesPhrase(text, phrase)).toBe(expected);
  });
});

describe('phraseMatches gap semantics', () => {
  const haystack = ['vue', 'component', 'framework', 'version', '3'];
  it('honors the maxGap window', () => {
    // vue ... 3 with three intervening tokens: outside gap 2, inside gap 3.
    expect(phraseMatches(haystack, ['vue', '3'], 2)).toBe(false);
    expect(phraseMatches(haystack, ['vue', '3'], 3)).toBe(true);
  });
  it('gap 0 demands adjacency (the exclusion posture)', () => {
    expect(phraseMatches(['equity', 'only'], ['equity', 'only'], 0)).toBe(true);
    expect(phraseMatches(['equity', 'compensation', 'only'], ['equity', 'only'], 0)).toBe(false);
  });
  it('an empty phrase matches nothing', () => {
    expect(phraseMatches(haystack, [], 2)).toBe(false);
  });
  it('retries later start positions when an early partial match dead-ends', () => {
    // First 'a' leads to a dead end; the match exists from the second 'a'.
    expect(phraseMatches(['a', 'x', 'x', 'x', 'a', 'b'], ['a', 'b'], 2)).toBe(true);
  });
});

describe('numeric helpers', () => {
  it('round4 gives exact stable values', () => {
    expect(round4(1 / 3)).toBe(0.3333);
    expect(round4(0.80004)).toBe(0.8);
  });
  it('clamp01 bounds', () => {
    expect(clamp01(-0.2)).toBe(0);
    expect(clamp01(1.7)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
  });
  it('mean of empty input is 0 (callers pre-register their empty cases)', () => {
    expect(mean([])).toBe(0);
    expect(mean([0.5, 1])).toBe(0.75);
  });
});
