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

// Not a credential: replaced by real argon2 hashing when M0-07 auth lands.
const FAKE_PASSWORD_HASH = 'seed-fake-password-hash-see-m0-07';

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
      {
        userId: user.id,
        company: 'Globex Logistics',
        title: 'Application Developer',
        startDate: '2016-01-01',
        endDate: '2020-02-28',
      },
      {
        userId: user.id,
        company: 'Initech Games',
        title: 'QA Automation Engineer',
        startDate: '2012-06-01',
        endDate: '2015-12-31',
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
        summary:
          'Vue 2 → Vue 3 + Pinia migration of a data-intensive reporting platform; large-table render performance improved 25%.',
      },
      {
        userId: user.id,
        experienceId: acme?.id,
        name: 'API Caching Layer',
        provenance: 'professional',
        summary:
          'Redis caching with explicit freshness rules in front of warehouse queries; p95 latency 1.8s → ~90ms on cached endpoints.',
      },
      {
        userId: user.id,
        experienceId: globex?.id,
        name: 'Driver Notification Service',
        provenance: 'professional',
        summary:
          'Notification service for a driver-facing mobile app that measurably increased weekly active users.',
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

  // Shapes mirror docs/profile.example/job-criteria.md (M1-08 formalizes them).
  await db.insert(searchCriteria).values({
    userId: user.id,
    hardFilters: {
      base_salary_below_usd: 120_000,
      equity_only_compensation: true,
      five_day_onsite_outside_metro: 'Springfield',
      excluded_industries: ['gambling', 'deceptive_or_exploitative_products'],
    },
    positiveSignals: [
      'senior software engineer scope with meaningful ownership',
      'backend-leaning full-stack',
      'data-intensive product work',
      'remote-first or fully remote (US)',
    ],
    negativeSignals: ['junior or entry-level title', 'QA-only or test-execution role'],
    compBounds: {
      currency: 'USD',
      preferred_base_min: 150_000,
      preferred_base_max: 190_000,
      dealbreaker_base_below: 120_000,
    },
  });

  return {
    userId: user.id,
    skills: skills.length,
    experiences: 3,
    projects: projects.length,
  };
}
