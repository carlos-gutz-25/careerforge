import { asc, desc, eq, sql } from 'drizzle-orm';
import { type ProjectProvenance, type SkillLevel } from '@careerforge/core';

import { type Db } from '../client.ts';
import { profileExperiences, profileProjects, profileSkills } from '../schema/profile.ts';

export type ProfileSkill = typeof profileSkills.$inferSelect;
export type ProfileExperience = typeof profileExperiences.$inferSelect;
export type ProfileProject = typeof profileProjects.$inferSelect;

// Parsed-markdown shapes handed over by the importer (apps/api owns the
// parsing; this repository owns how they land in Postgres).
export interface ProfileImportSkill {
  name: string;
  category: string | null;
  level: SkillLevel;
  years: number | null;
  lastUsed: string | null;
}

export interface ProfileImportExperience {
  company: string;
  title: string;
  startDate: string;
  endDate: string | null;
}

export interface ProfileImportProject {
  name: string;
  /** Links a professional project to its experience by company name. */
  company: string | null;
  provenance: ProjectProvenance;
  summary: string | null;
}

export interface ProfileImportData {
  skills: ProfileImportSkill[];
  experiences: ProfileImportExperience[];
  projects: ProfileImportProject[];
}

export interface SyncCounts {
  inserted: number;
  updated: number;
  deleted: number;
}

export interface ProfileSyncSummary {
  skills: SyncCounts;
  experiences: SyncCounts;
  projects: SyncCounts;
}

/** The user's profile rows, read for GET /profile (M0-10). */
export interface ProfileData {
  skills: ProfileSkill[];
  experiences: ProfileExperience[];
  projects: ProfileProject[];
}

export interface ProfileRepository {
  /**
   * All profile rows for the user, deterministically ordered so identical
   * data always serializes identically: skills by (category, lower(name)) —
   * Postgres puts NULL categories last; experiences newest-first by
   * start_date with lower(company)/lower(title) tiebreaks (the natural key
   * guarantees uniqueness from there); projects by lower(name).
   */
  getProfile(userId: string): Promise<ProfileData>;
  /**
   * Makes the user's profile rows an exact mirror of the parsed markdown
   * (approved M0-08 semantics): upsert by natural key — skills/projects
   * (user_id, lower(name)); experiences (user_id, lower(company),
   * lower(title), start_date) — then delete rows absent from the source.
   * Unchanged rows are not rewritten, so a re-import of identical markdown
   * reports all-zero counts (the idempotency evidence).
   */
  syncProfile(userId: string, data: ProfileImportData): Promise<ProfileSyncSummary>;
  /** Current row counts for the user, for import evidence/reporting. */
  countsFor(userId: string): Promise<{ skills: number; experiences: number; projects: number }>;
}

const experienceKey = (row: { company: string; title: string; startDate: string }) =>
  `${row.company.toLowerCase()}|${row.title.toLowerCase()}|${row.startDate}`;

export function createProfileRepository(db: Db): ProfileRepository {
  return {
    async getProfile(userId) {
      const [skills, experiences, projects] = await Promise.all([
        db
          .select()
          .from(profileSkills)
          .where(eq(profileSkills.userId, userId))
          .orderBy(asc(profileSkills.category), asc(sql`lower(${profileSkills.name})`)),
        db
          .select()
          .from(profileExperiences)
          .where(eq(profileExperiences.userId, userId))
          .orderBy(
            desc(profileExperiences.startDate),
            asc(sql`lower(${profileExperiences.company})`),
            asc(sql`lower(${profileExperiences.title})`),
          ),
        db
          .select()
          .from(profileProjects)
          .where(eq(profileProjects.userId, userId))
          .orderBy(asc(sql`lower(${profileProjects.name})`)),
      ]);
      return { skills, experiences, projects };
    },

    syncProfile(userId, data) {
      return db.transaction(async (tx) => {
        const summary: ProfileSyncSummary = {
          skills: { inserted: 0, updated: 0, deleted: 0 },
          experiences: { inserted: 0, updated: 0, deleted: 0 },
          projects: { inserted: 0, updated: 0, deleted: 0 },
        };

        // ── experiences (first: projects link to them) ──────────────────
        const existingExperiences = await tx
          .select()
          .from(profileExperiences)
          .where(eq(profileExperiences.userId, userId));
        const experiencesByKey = new Map(
          existingExperiences.map((row) => [experienceKey(row), row]),
        );
        const keptExperienceKeys = new Set<string>();
        // A professional project links to the company's most recent stint.
        const experienceIdByCompany = new Map<string, { id: string; startDate: string }>();

        for (const parsed of data.experiences) {
          const key = experienceKey(parsed);
          keptExperienceKeys.add(key);
          const existing = experiencesByKey.get(key);
          let row: ProfileExperience;
          if (existing) {
            const changed =
              existing.company !== parsed.company || // casing within the same key
              existing.title !== parsed.title;
            const endDateChanged = existing.endDate !== parsed.endDate;
            if (changed || endDateChanged) {
              const [updated] = await tx
                .update(profileExperiences)
                .set({ company: parsed.company, title: parsed.title, endDate: parsed.endDate })
                .where(eq(profileExperiences.id, existing.id))
                .returning();
              if (!updated) throw new Error('profile_experiences update returned no row');
              row = updated;
              summary.experiences.updated++;
            } else {
              row = existing;
            }
          } else {
            const [inserted] = await tx
              .insert(profileExperiences)
              .values({ userId, ...parsed })
              .returning();
            if (!inserted) throw new Error('profile_experiences insert returned no row');
            row = inserted;
            summary.experiences.inserted++;
          }
          const companyKey = row.company.toLowerCase();
          const current = experienceIdByCompany.get(companyKey);
          if (!current || current.startDate < row.startDate) {
            experienceIdByCompany.set(companyKey, { id: row.id, startDate: row.startDate });
          }
        }

        for (const row of existingExperiences) {
          if (keptExperienceKeys.has(experienceKey(row))) continue;
          await tx.delete(profileExperiences).where(eq(profileExperiences.id, row.id));
          summary.experiences.deleted++;
        }

        // ── projects (read AFTER experience deletes: those SET NULL links) ─
        const existingProjects = await tx
          .select()
          .from(profileProjects)
          .where(eq(profileProjects.userId, userId));
        const projectsByName = new Map(
          existingProjects.map((row) => [row.name.toLowerCase(), row]),
        );
        const keptProjectNames = new Set<string>();

        for (const parsed of data.projects) {
          let experienceId: string | null = null;
          if (parsed.provenance === 'professional') {
            // The parser already hard-errors on unknown companies; this is the
            // repository refusing to write a silently unlinked row anyway.
            const linked =
              parsed.company === null
                ? undefined
                : experienceIdByCompany.get(parsed.company.toLowerCase());
            if (!linked) throw new Error('professional project references an unknown company');
            experienceId = linked.id;
          }

          const nameKey = parsed.name.toLowerCase();
          keptProjectNames.add(nameKey);
          const existing = projectsByName.get(nameKey);
          if (existing) {
            const changed =
              existing.name !== parsed.name ||
              existing.provenance !== parsed.provenance ||
              existing.summary !== parsed.summary ||
              existing.experienceId !== experienceId;
            if (changed) {
              await tx
                .update(profileProjects)
                .set({
                  name: parsed.name,
                  provenance: parsed.provenance,
                  summary: parsed.summary,
                  experienceId,
                })
                .where(eq(profileProjects.id, existing.id));
              summary.projects.updated++;
            }
          } else {
            await tx.insert(profileProjects).values({
              userId,
              experienceId,
              name: parsed.name,
              provenance: parsed.provenance,
              summary: parsed.summary,
            });
            summary.projects.inserted++;
          }
        }

        for (const row of existingProjects) {
          if (keptProjectNames.has(row.name.toLowerCase())) continue;
          await tx.delete(profileProjects).where(eq(profileProjects.id, row.id));
          summary.projects.deleted++;
        }

        // ── skills ────────────────────────────────────────────────────────
        const existingSkills = await tx
          .select()
          .from(profileSkills)
          .where(eq(profileSkills.userId, userId));
        const skillsByName = new Map(existingSkills.map((row) => [row.name.toLowerCase(), row]));
        const keptSkillNames = new Set<string>();

        for (const parsed of data.skills) {
          const nameKey = parsed.name.toLowerCase();
          keptSkillNames.add(nameKey);
          const existing = skillsByName.get(nameKey);
          if (existing) {
            const changed =
              existing.name !== parsed.name ||
              existing.category !== parsed.category ||
              existing.level !== parsed.level ||
              existing.years !== parsed.years ||
              existing.lastUsed !== parsed.lastUsed;
            if (changed) {
              await tx
                .update(profileSkills)
                .set({
                  name: parsed.name,
                  category: parsed.category,
                  level: parsed.level,
                  years: parsed.years,
                  lastUsed: parsed.lastUsed,
                })
                .where(eq(profileSkills.id, existing.id));
              summary.skills.updated++;
            }
          } else {
            await tx.insert(profileSkills).values({ userId, ...parsed });
            summary.skills.inserted++;
          }
        }

        for (const row of existingSkills) {
          if (keptSkillNames.has(row.name.toLowerCase())) continue;
          await tx.delete(profileSkills).where(eq(profileSkills.id, row.id));
          summary.skills.deleted++;
        }

        return summary;
      });
    },

    async countsFor(userId) {
      const [skills, experiences, projects] = await Promise.all([
        db.$count(profileSkills, eq(profileSkills.userId, userId)),
        db.$count(profileExperiences, eq(profileExperiences.userId, userId)),
        db.$count(profileProjects, eq(profileProjects.userId, userId)),
      ]);
      return { skills, experiences, projects };
    },
  };
}
