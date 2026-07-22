import { defineCollection, defineContentConfig, z } from '@nuxt/content';

// Two collections:
//   pages       — the scaffold/home content (everything EXCEPT case studies).
//   caseStudies — M2-04's honesty-labeled case studies (content/case-studies/*.md).
//
// The caseStudies `schema` below is TYPING + DOCUMENTATION ONLY. @nuxt/content
// 3.15.0 performs NO validation at ingest — its zod schema is converted to JSON
// Schema for column typing, the parse path never calls safeParse, a missing
// required field inserts NULL and an out-of-enum value inserts verbatim. So
// `nuxt generate` builds GREEN on schema-violating content; 100% of the
// enforcement lives in scripts/validate-case-studies.mjs (the case-study content
// gate, run in portfolio-build). See that script's header + ADR-0010.
export default defineContentConfig({
  collections: {
    pages: defineCollection({
      type: 'page',
      // Dual-glob exclusion so case studies are ingested by caseStudies ONLY,
      // never double-ingested here (collections glob independently; the
      // leading-separator variant also covers the dev watcher's path shape).
      source: { include: '**/*.md', exclude: ['case-studies/**', '**/case-studies/**'] },
    }),
    caseStudies: defineCollection({
      type: 'page',
      source: 'case-studies/*.md',
      schema: z.object({
        provenance: z.enum(['professional', 'personal', 'personal_ai_assisted']),
        date: z.string().optional(), // YYYY-MM-DD (validator-checked)
        sensitivityReviewed: z.string().optional(), // YYYY-MM-DD; REQUIRED iff professional (R3)
        sources: z.array(z.string()).optional(),
      }),
    }),
  },
});
