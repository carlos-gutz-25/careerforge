import { eq } from 'drizzle-orm';

import { type Db } from './client.ts';
import {
  profileExperiences,
  profileProjects,
  profileSkills,
  searchCriteria,
  users,
} from './schema/index.ts';

// Dev seed = the FICTIONAL example profile (docs/profile.example/, Alex
// Rivera) and nothing else — real data never ships in the repo (RISKS P-01).
// Parsing the actual markdown is the M0-08 importer; this mirrors it by hand.
export const SEED_USER_EMAIL = 'alex.rivera.example@example.com';

// INTENTIONALLY never a valid argon2 hash (ratified M0-07): the example user
// can never authenticate — no working credential ships in this public repo,
// and this package stays argon2-free. Safe because the API's verifyPassword
// treats a malformed stored hash as a failed match, never an error; the only
// login-able user is the env-seeded one (apps/api bootstrap).
const FAKE_PASSWORD_HASH = 'unverifiable-by-design-example-user-cannot-log-in';

export interface SeedSummary {
  userId: string;
  skills: number;
  experiences: number;
  projects: number;
}

/** Idempotent: upserts the example user, then delete-and-reinserts their profile rows. */
export async function seed(db: Db): Promise<SeedSummary> {
  const [existing] = await db.select().from(users).where(eq(users.email, SEED_USER_EMAIL));
  const user =
    existing ??
    (
      await db
        .insert(users)
        .values({ email: SEED_USER_EMAIL, passwordHash: FAKE_PASSWORD_HASH })
        .returning()
    )[0];
  if (!user) throw new Error('seed user upsert returned no row');

  // Delete order respects FKs (projects reference experiences).
  await db.delete(profileProjects).where(eq(profileProjects.userId, user.id));
  await db.delete(profileExperiences).where(eq(profileExperiences.userId, user.id));
  await db.delete(profileSkills).where(eq(profileSkills.userId, user.id));
  await db.delete(searchCriteria).where(eq(searchCriteria.userId, user.id));

  const [acme, globex] = await db
    .insert(profileExperiences)
    .values([
      {
        userId: user.id,
        company: 'Acme Analytics Co.',
        title: 'Senior Software Engineer',
        startDate: '2020-03-01',
      },
      // Year-only periods land as Jan 1 / Dec 31, matching what the M0-08
      // importer parses from the example resume's "2016 - 2020" style —
      // seed then import must be a no-op sync.
      {
        userId: user.id,
        company: 'Globex Logistics',
        title: 'Application Developer',
        startDate: '2016-01-01',
        endDate: '2020-12-31',
      },
      {
        userId: user.id,
        company: 'Initech Games',
        title: 'QA Automation Engineer',
        startDate: '2012-01-01',
        endDate: '2016-12-31',
      },
    ])
    .returning();

  const projects = await db
    .insert(profileProjects)
    .values([
      {
        userId: user.id,
        experienceId: acme?.id,
        name: 'Reporting Dashboard Modernization',
        provenance: 'professional',
        // Summaries are the projects.md description paragraphs verbatim, so
        // the M0-08 importer's sync sees these rows as unchanged.
        summary:
          'Modernized a data-intensive internal reporting platform used by account managers.',
      },
      {
        userId: user.id,
        experienceId: acme?.id,
        name: 'API Caching Layer',
        provenance: 'professional',
        summary: 'Designed a Redis caching strategy for frequently requested reporting endpoints.',
      },
      {
        userId: user.id,
        experienceId: globex?.id,
        name: 'Driver Notification Service',
        provenance: 'professional',
        summary: 'Built the notification backend for a driver-facing mobile app.',
      },
    ])
    .returning();

  const skills = await db
    .insert(profileSkills)
    .values([
      { userId: user.id, name: 'TypeScript', category: 'language', level: 'expert', years: 8 },
      { userId: user.id, name: 'Node.js', category: 'runtime', level: 'expert', years: 10 },
      { userId: user.id, name: 'Vue.js 3', category: 'framework', level: 'expert', years: 5 },
      { userId: user.id, name: 'PostgreSQL', category: 'database', level: 'solid', years: 8 },
      { userId: user.id, name: 'Redis', category: 'database', level: 'solid', years: 6 },
      { userId: user.id, name: 'Docker', category: 'devops', level: 'solid', years: 7 },
      { userId: user.id, name: 'GitHub Actions', category: 'devops', level: 'solid', years: 5 },
      {
        userId: user.id,
        name: 'Python',
        category: 'language',
        level: 'rusty',
        years: 4,
        lastUsed: '2016-01-01',
      },
    ])
    .returning();

  // Canonical M1-08 criteria shapes (packages/core criteria schemas — the
  // fictional-analog values of docs/profile.example/job-criteria.md's YAML
  // blocks, which the M1-08 importer parses; seed.test pins that this
  // payload passes searchCriteriaSchema).
  await db.insert(searchCriteria).values({
    userId: user.id,
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
      role: ['senior_software_engineer', 'senior_backend_engineer'],
      technologies: ['typescript', 'node_js', 'vue_3', 'postgresql', 'redis'],
      problem_domains: ['api_platforms', 'analytics', 'performance', 'payments_and_fintech'],
      work_arrangement: ['remote_us'],
      scope: ['architecture', 'system_ownership'],
    },
    negativeSignals: ['frontend_only', 'unclear_salary', 'short_term_contract'],
    forceLowestPriority: { industry: ['multilevel_marketing'] },
    compBounds: {
      currency: 'usd',
      base_preferred_min: 150_000,
      base_preferred_max: 190_000,
      total_preferred_min: 165_000,
      total_preferred_max: 230_000,
    },
  });

  return {
    userId: user.id,
    skills: skills.length,
    experiences: 3,
    projects: projects.length,
  };
}
