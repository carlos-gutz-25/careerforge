import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  maxSkillLevel,
  skillNameKey,
  type ProjectProvenance,
  type SkillLevel,
} from '@careerforge/core';

import { type Db } from '../client.ts';
import {
  profileExperienceBullets,
  profileExperiences,
  profileProjects,
  profileSkills,
} from '../schema/profile.ts';
import { skillUpgrades } from '../schema/skill-upgrades.ts';

export type ProfileSkill = typeof profileSkills.$inferSelect;

/**
 * A profile skill as served by getProfile (M3-06, ADR-0014): `level` is the
 * EFFECTIVE level — max(declared, active earned grants) — while `declaredLevel`
 * preserves the raw markdown-owned value. Both are computed by the overlay at
 * this single read choke point; the underlying `profile_skills.level` column is
 * never mutated by this story.
 */
export interface ProfileSkillEffective extends ProfileSkill {
  declaredLevel: SkillLevel;
}
export type ProfileExperience = typeof profileExperiences.$inferSelect;
export type ProfileProject = typeof profileProjects.$inferSelect;

/** One experience bullet on the wire/read path (M2-12) — id + text + source
 *  order; the durable snapshot columns (user_id, timestamps) stay off. */
export interface ProfileExperienceBullet {
  id: string;
  text: string;
  position: number;
}

/** An experience with its ordered bullets nested (getProfile shape, M2-12). */
export interface ProfileExperienceWithBullets extends ProfileExperience {
  bullets: ProfileExperienceBullet[];
}

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
  /** Verbatim bullets in source order (M2-12); [] when the entry has none. */
  bullets: string[];
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
  /** Aggregate across all experiences' bullets (M2-12). */
  bullets: SyncCounts;
}

/** The user's profile rows, read for GET /profile (M0-10). Bullets ride on the
 *  experiences; the GET /profile response schema strips them (export-only,
 *  M2-12) — they exist here for the resume-tailoring payload builder. Skills
 *  carry the M3-06 effective/declared split (the overlay). */
export interface ProfileData {
  skills: ProfileSkillEffective[];
  experiences: ProfileExperienceWithBullets[];
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
  countsFor(
    userId: string,
  ): Promise<{ skills: number; experiences: number; projects: number; bullets: number }>;
}

const experienceKey = (row: { company: string; title: string; startDate: string }) =>
  `${row.company.toLowerCase()}|${row.title.toLowerCase()}|${row.startDate}`;

export function createProfileRepository(db: Db): ProfileRepository {
  return {
    async getProfile(userId) {
      const [skills, experiences, projects, bulletRows, activeGrants] = await Promise.all([
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
        db
          .select()
          .from(profileExperienceBullets)
          .where(eq(profileExperienceBullets.userId, userId))
          .orderBy(asc(profileExperienceBullets.position)),
        // M3-06 overlay: the user's ACTIVE earned grants. Only skill_name_key +
        // to_level are needed to fold into the effective level (ADR-0014).
        db
          .select({ skillNameKey: skillUpgrades.skillNameKey, toLevel: skillUpgrades.toLevel })
          .from(skillUpgrades)
          .where(and(eq(skillUpgrades.userId, userId), eq(skillUpgrades.status, 'active'))),
      ]);
      // M3-06: fold active grants onto skills by skillNameKey(name). effective =
      // max(declared, ...earned) — the combinator lives in core (maxSkillLevel);
      // this repo merely applies it (the computeRevisitState division of labor).
      // A grant whose key matches no current skill contributes nothing here (a
      // detached rename) — GET /skill-upgrades surfaces it as detached, not
      // getProfile. syncProfile and seed do NOT route through getProfile (raw tx
      // selects), so this overlay can never feed back into the mirror.
      const earnedByKey = new Map<string, SkillLevel[]>();
      for (const grant of activeGrants) {
        const list = earnedByKey.get(grant.skillNameKey);
        if (list) list.push(grant.toLevel);
        else earnedByKey.set(grant.skillNameKey, [grant.toLevel]);
      }
      const effectiveSkills: ProfileSkillEffective[] = skills.map((skill) => {
        const earned = earnedByKey.get(skillNameKey(skill.name)) ?? [];
        return {
          ...skill,
          declaredLevel: skill.level,
          level: maxSkillLevel(skill.level, ...earned),
        };
      });
      // Nest bullets under their experience in source order (M2-12).
      const bulletsByExperience = new Map<string, ProfileExperienceBullet[]>();
      for (const row of bulletRows) {
        const bucket = bulletsByExperience.get(row.experienceId);
        const bullet = { id: row.id, text: row.text, position: row.position };
        if (bucket) bucket.push(bullet);
        else bulletsByExperience.set(row.experienceId, [bullet]);
      }
      return {
        skills: effectiveSkills,
        experiences: experiences.map((experience) => ({
          ...experience,
          bullets: bulletsByExperience.get(experience.id) ?? [],
        })),
        projects,
      };
    },

    syncProfile(userId, data) {
      return db.transaction(async (tx) => {
        const summary: ProfileSyncSummary = {
          skills: { inserted: 0, updated: 0, deleted: 0 },
          experiences: { inserted: 0, updated: 0, deleted: 0 },
          projects: { inserted: 0, updated: 0, deleted: 0 },
          bullets: { inserted: 0, updated: 0, deleted: 0 },
        };

        // Ordered-list mirror of one experience's bullets, keyed by position:
        // reword-at-position = update, new tail = insert, shrunk tail = delete.
        // (A deleted experience takes its bullets via the FK CASCADE, so this
        // only runs for kept experiences.)
        const syncExperienceBullets = async (experienceId: string, bullets: string[]) => {
          const existing = await tx
            .select()
            .from(profileExperienceBullets)
            .where(eq(profileExperienceBullets.experienceId, experienceId))
            .orderBy(asc(profileExperienceBullets.position));
          const existingByPosition = new Map(existing.map((row) => [row.position, row]));
          for (let position = 0; position < bullets.length; position++) {
            const text = bullets[position] ?? '';
            const current = existingByPosition.get(position);
            if (!current) {
              await tx
                .insert(profileExperienceBullets)
                .values({ userId, experienceId, text, position });
              summary.bullets.inserted++;
            } else if (current.text !== text) {
              await tx
                .update(profileExperienceBullets)
                .set({ text })
                .where(eq(profileExperienceBullets.id, current.id));
              summary.bullets.updated++;
            }
          }
          for (const row of existing) {
            if (row.position >= bullets.length) {
              await tx
                .delete(profileExperienceBullets)
                .where(eq(profileExperienceBullets.id, row.id));
              summary.bullets.deleted++;
            }
          }
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

          await syncExperienceBullets(row.id, parsed.bullets);
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
        // M3-06 (park 3): the parser-writer and the upgrade-writer share ONE
        // normalization — skillNameKey (= lower(name), the DB index expression).
        const skillsByName = new Map(existingSkills.map((row) => [skillNameKey(row.name), row]));
        const keptSkillNames = new Set<string>();

        for (const parsed of data.skills) {
          const nameKey = skillNameKey(parsed.name);
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
          if (keptSkillNames.has(skillNameKey(row.name))) continue;
          await tx.delete(profileSkills).where(eq(profileSkills.id, row.id));
          summary.skills.deleted++;
        }

        return summary;
      });
    },

    async countsFor(userId) {
      const [skills, experiences, projects, bullets] = await Promise.all([
        db.$count(profileSkills, eq(profileSkills.userId, userId)),
        db.$count(profileExperiences, eq(profileExperiences.userId, userId)),
        db.$count(profileProjects, eq(profileProjects.userId, userId)),
        db.$count(profileExperienceBullets, eq(profileExperienceBullets.userId, userId)),
      ]);
      return { skills, experiences, projects, bullets };
    },
  };
}
