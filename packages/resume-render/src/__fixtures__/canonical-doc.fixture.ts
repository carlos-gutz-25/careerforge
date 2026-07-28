import { type CanonicalResumeDoc } from '@careerforge/core';

// FICTIONAL canonical resume document (privacy law: fixtures use fictional data
// only, never docs/profile/). The Jordan Rivera persona. Exercises every
// section, an entity with multiple claims, a claim carrying markdown
// metacharacters (the non-interpretation test), a null-headline-free contact,
// and education with null years. The determinism goldens render from this.
export const CANONICAL_DOC_FIXTURE: CanonicalResumeDoc = {
  contact: {
    fullName: 'Jordan Rivera',
    headline: 'Senior Platform Engineer',
    email: 'jordan.rivera@example.com',
    phone: '+1-555-0142',
    location: 'Austin, TX',
    links: [
      { label: 'GitHub', url: 'https://github.example/jrivera' },
      { label: 'Site', url: 'https://jrivera.example' },
    ],
  },
  education: [
    {
      institution: 'State University',
      credential: 'B.S. Computer Science',
      startYear: 2011,
      endYear: 2015,
    },
    { institution: 'Community College', credential: null, startYear: null, endYear: null },
  ],
  skills: [
    { name: 'TypeScript', level: 'expert' },
    { name: 'PostgreSQL', level: 'solid' },
    { name: 'Kubernetes', level: 'rusty' },
    { name: 'Rust', level: 'learning' },
  ],
  claims: [
    {
      section: 'summary',
      entityRef: null,
      entityLabel: null,
      text: 'Platform engineer focused on reliability and developer velocity.',
      position: 0,
    },
    {
      section: 'experience',
      entityRef: 'x1',
      entityLabel: 'Acme Corp - Senior Engineer',
      text: 'Cut p95 latency by _40%_ via `caching` & [indexes](#) - shipped v2.0.',
      position: 1,
    },
    {
      section: 'experience',
      entityRef: 'x1',
      entityLabel: 'Acme Corp - Senior Engineer',
      text: 'Led a team of four to migrate billing to an event-driven design.',
      position: 2,
    },
    {
      section: 'experience',
      entityRef: 'x2',
      entityLabel: 'Globex - Engineer',
      text: 'Owned the observability stack across twelve services.',
      position: 3,
    },
    {
      section: 'project',
      entityRef: 'p1',
      entityLabel: 'Ledger CLI',
      text: 'Built an offline-first double-entry ledger with a plugin API.',
      position: 4,
    },
  ],
};
