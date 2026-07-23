import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, pgErrorCode, truncateAllTables } from '../test/db-test-utils.ts';
import { profileSkills } from '../schema/profile.ts';
import { createProfileRepository, type ProfileImportData } from './profile.repository.ts';
import { createUsersRepository } from './users.repository.ts';

// Fictional fixture data only, mirroring docs/profile.example/ (RISKS P-01).
const ALEX = {
  email: 'alex.rivera.example@example.com',
  passwordHash: 'fake-hash-not-a-real-credential',
};

function importData(): ProfileImportData {
  return {
    skills: [
      { name: 'TypeScript', category: 'language', level: 'expert', years: 8, lastUsed: null },
      { name: 'Python', category: 'language', level: 'rusty', years: 4, lastUsed: '2016-01-01' },
    ],
    experiences: [
      {
        company: 'Acme Analytics Co.',
        title: 'Senior Software Engineer',
        startDate: '2020-03-01',
        endDate: null,
        bullets: ['Led a fictional migration to Vue 3.', 'Cut fictional p95 latency by half.'],
      },
      {
        company: 'Globex Logistics',
        title: 'Application Developer',
        startDate: '2016-01-01',
        endDate: '2020-12-31',
        bullets: ['Built fictional Node.js APIs.'],
      },
    ],
    projects: [
      {
        name: 'Reporting Dashboard Modernization',
        company: 'Acme Analytics Co.',
        provenance: 'professional',
        summary: 'Modernized a fictional reporting platform.',
      },
      {
        name: 'Garden Tracker',
        company: null,
        provenance: 'personal_ai_assisted',
        summary: 'A fictional garden planning app.',
      },
    ],
  };
}

const ZERO = { inserted: 0, updated: 0, deleted: 0 };

const handle = createTestDb();
const repo = createProfileRepository(handle.db);
const users = createUsersRepository(handle.db);

beforeEach(() => truncateAllTables(handle));
afterAll(() => handle.pool.end());

describe('ProfileRepository.syncProfile (integration)', () => {
  it('first import inserts everything and links professional projects', async () => {
    const user = await users.create(ALEX);
    const summary = await repo.syncProfile(user.id, importData());

    expect(summary).toEqual({
      skills: { inserted: 2, updated: 0, deleted: 0 },
      experiences: { inserted: 2, updated: 0, deleted: 0 },
      projects: { inserted: 2, updated: 0, deleted: 0 },
      bullets: { inserted: 3, updated: 0, deleted: 0 },
    });
    expect(await repo.countsFor(user.id)).toEqual({
      skills: 2,
      experiences: 2,
      projects: 2,
      bullets: 3,
    });

    const { rows } = await handle.pool.query<{ name: string; company: string | null }>(
      `select p.name, e.company
         from profile_projects p left join profile_experiences e on e.id = p.experience_id
        order by p.name`,
    );
    expect(rows).toEqual([
      { name: 'Garden Tracker', company: null },
      { name: 'Reporting Dashboard Modernization', company: 'Acme Analytics Co.' },
    ]);
  });

  it('re-importing identical data is a no-op: all-zero counts, identical rows', async () => {
    const user = await users.create(ALEX);
    await repo.syncProfile(user.id, importData());
    const before = await handle.pool.query(
      `select id, name, updated_at from profile_skills order by name`,
    );

    const summary = await repo.syncProfile(user.id, importData());

    expect(summary).toEqual({ skills: ZERO, experiences: ZERO, projects: ZERO, bullets: ZERO });
    const after = await handle.pool.query(
      `select id, name, updated_at from profile_skills order by name`,
    );
    expect(after.rows).toEqual(before.rows); // same ids — updated, never duplicated
  });

  it('updates changed rows in place (matching case-insensitively) and keeps ids stable', async () => {
    const user = await users.create(ALEX);
    await repo.syncProfile(user.id, importData());
    const originalIds = (
      await handle.pool.query<{ id: string }>(`select id from profile_skills order by name`)
    ).rows.map((row) => row.id);

    const changed = importData();
    changed.skills[0] = {
      name: 'typescript', // casing change rides the same natural key
      category: 'language',
      level: 'solid',
      years: 9,
      lastUsed: null,
    };
    changed.experiences[0] = {
      company: 'Acme Analytics Co.',
      title: 'Senior Software Engineer',
      startDate: '2020-03-01',
      endDate: '2026-06-30',
      // Same bullets as the original Acme stint — only the endDate changes, so
      // bullets must not churn.
      bullets: ['Led a fictional migration to Vue 3.', 'Cut fictional p95 latency by half.'],
    };
    changed.projects[0] = {
      name: 'Reporting Dashboard Modernization',
      company: 'Acme Analytics Co.',
      provenance: 'professional',
      summary: 'Rewritten fictional summary.',
    };

    const summary = await repo.syncProfile(user.id, changed);

    expect(summary).toEqual({
      skills: { inserted: 0, updated: 1, deleted: 0 },
      experiences: { inserted: 0, updated: 1, deleted: 0 },
      projects: { inserted: 0, updated: 1, deleted: 0 },
      bullets: ZERO,
    });
    const skills = await handle.pool.query<{ id: string; name: string; level: string }>(
      `select id, name, level from profile_skills order by name`,
    );
    expect(skills.rows.map((row) => row.id).sort()).toEqual([...originalIds].sort());
    expect(skills.rows.find((row) => row.level === 'solid')?.name).toBe('typescript');
  });

  it('deletes rows that disappeared from the source (full-sync mirror)', async () => {
    const user = await users.create(ALEX);
    await repo.syncProfile(user.id, importData());

    const shrunk = importData();
    shrunk.skills.pop();
    shrunk.projects.pop();
    const summary = await repo.syncProfile(user.id, shrunk);

    expect(summary).toEqual({
      skills: { inserted: 0, updated: 0, deleted: 1 },
      experiences: ZERO,
      projects: { inserted: 0, updated: 0, deleted: 1 },
      bullets: ZERO,
    });
    expect(await repo.countsFor(user.id)).toEqual({
      skills: 1,
      experiences: 2,
      projects: 1,
      bullets: 3,
    });
  });

  it('relinks projects when an experience is replaced, and scopes sync to the user', async () => {
    const user = await users.create(ALEX);
    const bystander = await users.create({
      email: 'casey.tester@example.com',
      passwordHash: 'another-fake-hash',
    });
    await repo.syncProfile(bystander.id, importData());
    await repo.syncProfile(user.id, importData());

    // New stint at the same company: old experience row goes away, the
    // professional project must follow the replacement, not go NULL.
    const moved = importData();
    moved.experiences[0] = {
      company: 'Acme Analytics Co.',
      title: 'Principal Fiction Engineer',
      startDate: '2026-01-01',
      endDate: null,
      bullets: [],
    };
    const summary = await repo.syncProfile(user.id, moved);

    expect(summary.experiences).toEqual({ inserted: 1, updated: 0, deleted: 1 });
    expect(summary.projects).toEqual({ inserted: 0, updated: 1, deleted: 0 });
    const { rows } = await handle.pool.query<{ title: string }>(
      `select e.title from profile_projects p
         join profile_experiences e on e.id = p.experience_id
        where p.user_id = $1 and p.name = 'Reporting Dashboard Modernization'`,
      [user.id],
    );
    expect(rows).toEqual([{ title: 'Principal Fiction Engineer' }]);

    // The bystander's mirror is untouched.
    expect(await repo.countsFor(bystander.id)).toEqual({
      skills: 2,
      experiences: 2,
      projects: 2,
      bullets: 3,
    });
  });

  it('DB backstop: the unique index rejects case-variant duplicates written around the repo', async () => {
    const user = await users.create(ALEX);
    await repo.syncProfile(user.id, importData());
    await expect(
      handle.db.insert(profileSkills).values({
        userId: user.id,
        name: 'TYPESCRIPT',
        level: 'learning',
      }),
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23505', 'expected unique_violation');
  });
});

describe('ProfileRepository.getProfile (integration)', () => {
  it('returns empty arrays for a user with no profile rows', async () => {
    const user = await users.create(ALEX);
    expect(await repo.getProfile(user.id)).toEqual({
      skills: [],
      experiences: [],
      projects: [],
    });
  });

  it('returns full rows in the documented deterministic order, scoped to the user', async () => {
    const user = await users.create(ALEX);
    const bystander = await users.create({
      email: 'jordan.chen.example@example.com',
      passwordHash: 'fake-hash-not-a-real-credential',
    });
    await repo.syncProfile(bystander.id, importData());
    await repo.syncProfile(user.id, {
      skills: [
        // Crafted to exercise every ordering rule: category asc (NULL last),
        // then lower(name) asc within a category.
        { name: 'TypeScript', category: 'language', level: 'expert', years: 8, lastUsed: null },
        { name: 'agile facilitation', category: null, level: 'solid', years: 6, lastUsed: null },
        { name: 'Vue', category: 'framework', level: 'expert', years: 5, lastUsed: null },
        { name: 'python', category: 'language', level: 'rusty', years: 4, lastUsed: '2016-01-01' },
      ],
      experiences: [
        // Two stints share a start_date so the lower(company) tiebreak shows.
        {
          company: 'Acme Analytics Co.',
          title: 'Senior Software Engineer',
          startDate: '2020-03-01',
          endDate: null,
          // Order deliberately NOT alphabetical — proves position order is kept.
          bullets: ['Zeroth fictional bullet.', 'First fictional bullet.'],
        },
        {
          company: 'beta systems',
          title: 'Software Engineer',
          startDate: '2020-03-01',
          endDate: '2021-06-30',
          bullets: [],
        },
        {
          company: 'Globex Logistics',
          title: 'Application Developer',
          startDate: '2016-01-01',
          endDate: '2020-02-28',
          bullets: ['Sole fictional bullet.'],
        },
      ],
      projects: [
        { name: 'Zephyr CLI', company: null, provenance: 'personal', summary: null },
        {
          name: 'analytics pipeline',
          company: 'Acme Analytics Co.',
          provenance: 'professional',
          summary: 'A fictional pipeline.',
        },
      ],
    });

    const result = await repo.getProfile(user.id);

    // Ordering: skills by (category asc — NULLs last, lower(name) asc).
    expect(result.skills.map((s) => s.name)).toEqual([
      'Vue',
      'python',
      'TypeScript',
      'agile facilitation',
    ]);
    // Experiences newest-first, lower(company) tiebreak on equal start dates.
    expect(result.experiences.map((e) => e.company)).toEqual([
      'Acme Analytics Co.',
      'beta systems',
      'Globex Logistics',
    ]);
    // Projects by lower(name).
    expect(result.projects.map((p) => p.name)).toEqual(['analytics pipeline', 'Zephyr CLI']);

    // Full DB rows come back (the wire projection is the route schema's job).
    expect(result.skills[1]).toMatchObject({
      userId: user.id,
      name: 'python',
      category: 'language',
      level: 'rusty',
      years: 4,
      lastUsed: '2016-01-01',
    });
    const acme = result.experiences[0];
    // Bullets nest under their experience in source (position) order — not
    // alphabetized — and a bullet-less experience reads as [].
    expect(acme?.bullets.map((b) => b.text)).toEqual([
      'Zeroth fictional bullet.',
      'First fictional bullet.',
    ]);
    expect(acme?.bullets.map((b) => b.position)).toEqual([0, 1]);
    expect(result.experiences[1]?.bullets).toEqual([]);
    expect(result.experiences[2]?.bullets.map((b) => b.text)).toEqual(['Sole fictional bullet.']);
    expect(result.projects[0]).toMatchObject({
      experienceId: acme?.id,
      provenance: 'professional',
    });
    expect(result.projects[1]).toMatchObject({ experienceId: null, provenance: 'personal' });

    // Scoping: only the requested user's rows, and the bystander still reads
    // their own mirror.
    expect(result.skills.map((s) => s.userId)).toEqual(Array(4).fill(user.id));
    expect((await repo.getProfile(bystander.id)).skills.map((s) => s.name)).toEqual([
      'Python',
      'TypeScript',
    ]);
  });
});

describe('ProfileRepository experience-bullet sync (M2-12, integration)', () => {
  const bulletsOf = async (userId: string, company: string): Promise<string[]> =>
    (await repo.getProfile(userId)).experiences
      .find((experience) => experience.company === company)
      ?.bullets.map((bullet) => bullet.text) ?? [];

  it('reordering a bullet updates in place (position key), never insert+delete', async () => {
    const user = await users.create(ALEX);
    await repo.syncProfile(user.id, importData());
    const idsBefore = (
      await handle.pool.query<{ id: string }>(
        `select id from profile_experience_bullets order by position`,
      )
    ).rows.map((row) => row.id);

    const swapped = importData();
    swapped.experiences[0] = {
      ...swapped.experiences[0]!,
      bullets: ['Cut fictional p95 latency by half.', 'Led a fictional migration to Vue 3.'],
    };
    const summary = await repo.syncProfile(user.id, swapped);

    // Both positions changed text → two updates, no churn on the Globex bullet.
    expect(summary.bullets).toEqual({ inserted: 0, updated: 2, deleted: 0 });
    expect(await bulletsOf(user.id, 'Acme Analytics Co.')).toEqual([
      'Cut fictional p95 latency by half.',
      'Led a fictional migration to Vue 3.',
    ]);
    // Row ids are stable — an ordered-list update, not a delete+reinsert.
    const idsAfter = (
      await handle.pool.query<{ id: string }>(
        `select id from profile_experience_bullets order by position`,
      )
    ).rows.map((row) => row.id);
    expect([...idsAfter].sort()).toEqual([...idsBefore].sort());
  });

  it('shrinking the bullet list deletes the trailing rows', async () => {
    const user = await users.create(ALEX);
    await repo.syncProfile(user.id, importData());

    const shrunk = importData();
    shrunk.experiences[0] = {
      ...shrunk.experiences[0]!,
      bullets: ['Led a fictional migration to Vue 3.'], // drop the second
    };
    const summary = await repo.syncProfile(user.id, shrunk);

    expect(summary.bullets).toEqual({ inserted: 0, updated: 0, deleted: 1 });
    expect(await bulletsOf(user.id, 'Acme Analytics Co.')).toEqual([
      'Led a fictional migration to Vue 3.',
    ]);
    expect((await repo.countsFor(user.id)).bullets).toBe(2);
  });

  it('deleting an experience takes its bullets via the FK CASCADE', async () => {
    const user = await users.create(ALEX);
    await repo.syncProfile(user.id, importData());
    expect((await repo.countsFor(user.id)).bullets).toBe(3);

    // Drop the Globex stint from the source (and its dependent project).
    const dropped = importData();
    dropped.experiences.pop();
    dropped.projects = dropped.projects.filter((project) => project.company !== 'Globex Logistics');
    await repo.syncProfile(user.id, dropped);

    // Only Acme's two bullets remain — Globex's one went with the experience.
    expect((await repo.countsFor(user.id)).bullets).toBe(2);
    expect(await bulletsOf(user.id, 'Globex Logistics')).toEqual([]);
  });
});
