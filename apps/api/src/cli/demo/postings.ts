// M10-03 demo: AUTHORED FICTIONAL job postings — the input side of demo:capture.
// Every company, role, and detail here is invented (privacy law, RISKS P-01):
// these are plausible matches for the fictional Alex Rivera example profile
// (docs/profile.example/), deliberately spanning strong fits and real gaps
// (Kubernetes, GraphQL, Go, deeper AWS) so the captured fit reports, gaps, and
// downstream drafts have honest, varied content to show. Printable ASCII only;
// posting text stays UNTRUSTED at render like any posting (escaped, never HTML).

export interface DemoPostingInput {
  /** Stable key used in the exported fixture filenames + manifest. */
  slug: string;
  company: string;
  title: string;
  rawText: string;
}

export const DEMO_POSTINGS: readonly DemoPostingInput[] = [
  {
    slug: 'nimbus-senior-fullstack',
    company: 'Nimbus Retail Cloud',
    title: 'Senior Full-Stack Engineer',
    rawText: [
      'Senior Full-Stack Engineer — Nimbus Retail Cloud (Remote, US)',
      '',
      'Nimbus builds the storefront platform behind mid-market online retailers. We',
      'are looking for a senior engineer to own features end to end across our',
      'TypeScript stack.',
      '',
      'What you will do:',
      '- Build and maintain features in a TypeScript + Node.js backend and a Vue 3',
      '  front end backed by Pinia.',
      '- Design and evolve PostgreSQL schemas and the queries behind data-heavy',
      '  merchant dashboards.',
      '- Add Redis caching to keep hot read paths fast under seasonal load.',
      '- Own CI/CD for your services with GitHub Actions and feature-flagged rollouts.',
      '',
      'What we look for:',
      '- 6+ years building production web applications.',
      '- Strong TypeScript and Node.js; comfort with a modern Vue or React front end.',
      '- Solid relational database skills (PostgreSQL preferred) and caching experience.',
      '- A test-first habit; you write and value automated tests.',
      '',
      'Nice to have:',
      '- Experience running services on Kubernetes.',
      '- Exposure to GraphQL API design.',
    ].join('\n'),
  },
  {
    slug: 'beacon-senior-backend',
    company: 'Beacon Health Systems',
    title: 'Senior Backend Engineer (Node.js)',
    rawText: [
      'Senior Backend Engineer (Node.js) — Beacon Health Systems (Hybrid, Springfield)',
      '',
      'Beacon builds scheduling and messaging tools for regional clinics. This role',
      'is backend-focused: reliable APIs, event pipelines, and data integrity.',
      '',
      'Responsibilities:',
      '- Design and build Node.js APIs (TypeScript) for appointment and notification',
      '  workflows.',
      '- Model and query PostgreSQL for correctness under concurrent writes.',
      '- Build event producers and consumers integrating third-party fulfillment and',
      '  messaging providers.',
      '- Instrument services and drive down p95 latency on the busiest endpoints.',
      '',
      'Requirements:',
      '- 5+ years of backend engineering in Node.js.',
      '- Deep PostgreSQL experience; comfort designing schemas and indexes.',
      '- Experience with message queues / event-driven integration.',
      '- Test-driven development as a default working style.',
      '',
      'Bonus:',
      '- Go for high-throughput services.',
      '- Prior work in a regulated (HIPAA-adjacent) environment.',
    ].join('\n'),
  },
  {
    slug: 'cartographer-staff-platform',
    company: 'Cartographer Labs',
    title: 'Staff Software Engineer, Platform',
    rawText: [
      'Staff Software Engineer, Platform — Cartographer Labs (Remote, US)',
      '',
      'Cartographer builds developer tooling for geospatial data teams. The platform',
      'group owns the services and infrastructure other engineers build on.',
      '',
      'In this role you will:',
      '- Set technical direction for core platform services written in TypeScript and Go.',
      '- Own the Kubernetes-based deployment platform and its developer experience.',
      '- Design GraphQL and REST APIs consumed across many internal teams.',
      '- Deep AWS work: multi-service architecture, cost, and reliability.',
      '- Mentor senior engineers and lead cross-team technical reviews.',
      '',
      'We are looking for:',
      '- 8+ years of software engineering, including platform or infrastructure work.',
      '- Strong TypeScript plus at least one systems language (Go preferred).',
      '- Hands-on Kubernetes and AWS at production scale.',
      '- A track record of leading technical direction beyond a single team.',
    ].join('\n'),
  },
  {
    slug: 'tidewater-senior-fullstack',
    company: 'Tidewater Freight',
    title: 'Senior Software Engineer, Full-Stack',
    rawText: [
      'Senior Software Engineer, Full-Stack — Tidewater Freight (Remote, US)',
      '',
      'Tidewater moves freight for regional shippers and needs a senior engineer to',
      'build the tools our operations team lives in every day.',
      '',
      'The work:',
      '- Ship full-stack features across a Node.js + TypeScript backend and a Vue 3 UI.',
      '- Build data-heavy dashboards and keep large tables responsive.',
      '- Optimize slow API endpoints; a Redis caching layer is on the roadmap.',
      '- Maintain CI/CD with GitHub Actions and Docker-based builds.',
      '',
      'You bring:',
      '- 6+ years of full-stack web development.',
      '- Expert TypeScript and Node.js; strong Vue (or React) experience.',
      '- PostgreSQL fluency and an eye for query performance.',
      '- Comfort owning delivery from database to UI, with tests throughout.',
      '',
      'Nice to have:',
      '- AWS deployment experience.',
      '- Familiarity with observability tooling.',
    ].join('\n'),
  },
] as const;
