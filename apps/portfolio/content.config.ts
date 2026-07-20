import { defineCollection, defineContentConfig } from '@nuxt/content';

// Minimal scaffold collection so the Nuxt Content pipeline builds end to end.
// The case-study collection + its enforced section schema (problem, constraints,
// architecture, tradeoffs, testing, results, what-I'd-change) and provenance
// labeling arrive with M2-04 — NOT here.
export default defineContentConfig({
  collections: {
    pages: defineCollection({
      type: 'page',
      source: '**/*.md',
    }),
  },
});
