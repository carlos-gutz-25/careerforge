import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';

import { type SearchCriteriaData } from '@careerforge/core';
import {
  type ProfileData,
  type ProfileRepository,
  type ProfileSyncSummary,
  type SearchCriteriaRepository,
} from '@careerforge/db';

import { parseCriteria } from '../criteria/criteria-parser.ts';
import { ProfileParseError, type ParseIssue } from './parse-errors.ts';
import { parseProfile, type ParsedProfile, type SourceFile } from './profile-parser.ts';

export const PROFILE_SOURCE_FILES = {
  resume: 'resume.md',
  skills: 'skills.md',
  projects: 'projects.md',
  criteria: 'job-criteria.md',
} as const;

/**
 * The criteria leg's collision outcome (M1-08, pre-registered rule:
 * confirmation-gated — the M0-08 -> M3-06 lesson, decided explicitly).
 * `replaced` is reachable through the CLI's --force ONLY; the HTTP import
 * route never forces, so its response schema deliberately omits it.
 */
export type CriteriaImportOutcome = 'created' | 'unchanged' | 'skipped_existing' | 'replaced';

export interface ProfileImportSummary {
  /** What this import changed, per table. All-zero = idempotent re-import. */
  sync: ProfileSyncSummary;
  /** Row counts after the import (the "profile is populated" evidence). */
  totals: { skills: number; experiences: number; projects: number; bullets: number };
  criteria: { outcome: CriteriaImportOutcome };
}

export interface ProfileImportOptions {
  /** CLI --force only: overwrite a DIFFERING existing criteria row. */
  forceCriteria?: boolean;
}

export interface ProfileImportService {
  /** Parses the profile directory and mirrors it into the user's rows. */
  importProfile(userId: string, options?: ProfileImportOptions): Promise<ProfileImportSummary>;
}

export interface ProfileService {
  /** The user's profile rows for GET /profile (M0-10). */
  getProfile(userId: string): Promise<ProfileData>;
}

/**
 * Deliberate passthrough (approved shape 2026-07-15): the repository owns
 * row ordering, the route's response schema (packages/core) owns the wire
 * shape — no view shaping in between.
 */
export function createProfileService(deps: { profile: ProfileRepository }): ProfileService {
  return {
    getProfile: (userId) => deps.profile.getProfile(userId),
  };
}

export function createProfileImportService(deps: {
  /** Directory holding resume.md / skills.md / projects.md / job-criteria.md. */
  profileDir: string;
  profile: ProfileRepository;
  criteria: SearchCriteriaRepository;
}): ProfileImportService {
  async function readSource(name: string): Promise<SourceFile> {
    try {
      return { name, content: await readFile(path.join(deps.profileDir, name), 'utf8') };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new ProfileParseError([
          {
            file: name,
            line: 1,
            field: 'file',
            rule: 'file-missing',
            message: `file not found in the profile directory`,
          },
        ]);
      }
      throw error;
    }
  }

  /**
   * The pre-registered collision rule (M1-08 decision 2, confirmation-gated):
   * no row = create; identical = idempotent no-op; differing = REFUSE unless
   * forced — "differs" cannot tell doc-evolved from PUT-edited, and both mean
   * an overwrite would destroy a state someone chose. The refusal is an
   * outcome word, never a value diff.
   */
  async function syncCriteria(
    userId: string,
    data: SearchCriteriaData,
    force: boolean,
  ): Promise<CriteriaImportOutcome> {
    const existing = await deps.criteria.get(userId);
    if (!existing) {
      await deps.criteria.upsert(userId, data);
      return 'created';
    }
    const current: SearchCriteriaData = {
      hardFilters: existing.hardFilters,
      positiveSignals: existing.positiveSignals,
      negativeSignals: existing.negativeSignals,
      forceLowestPriority: existing.forceLowestPriority,
      compBounds: existing.compBounds,
    };
    // Structural equality, not string equality: Postgres jsonb does not
    // preserve key order, so a stringify comparison would report phantom
    // differences on identical criteria.
    if (isDeepStrictEqual(current, data)) return 'unchanged';
    if (!force) return 'skipped_existing';
    await deps.criteria.upsert(userId, data);
    return 'replaced';
  }

  return {
    async importProfile(userId, options = {}) {
      const [resume, skills, projects, criteriaSource] = await Promise.all([
        readSource(PROFILE_SOURCE_FILES.resume),
        readSource(PROFILE_SOURCE_FILES.skills),
        readSource(PROFILE_SOURCE_FILES.projects),
        readSource(PROFILE_SOURCE_FILES.criteria),
      ]);

      // Parse EVERYTHING first and aggregate every issue: a broken criteria
      // block blocks the profile-table sync too (all-or-nothing, extended
      // from M0-08 — one import attempt surfaces all fixes at once and a
      // failed attempt writes nothing).
      const issues: ParseIssue[] = [];
      let profileData: ParsedProfile | null = null;
      try {
        profileData = parseProfile({ resume, skills, projects });
      } catch (error) {
        if (!(error instanceof ProfileParseError)) throw error;
        issues.push(...error.issues);
      }
      const criteriaData = parseCriteria(criteriaSource, issues);
      if (profileData === null || criteriaData === undefined) {
        throw new ProfileParseError(issues);
      }

      const sync = await deps.profile.syncProfile(userId, profileData);
      const totals = await deps.profile.countsFor(userId);
      // Criteria AFTER the table sync: a skipped_existing criteria row never
      // blocks the profile tables from mirroring their sources.
      const outcome = await syncCriteria(userId, criteriaData, options.forceCriteria === true);
      return { sync, totals, criteria: { outcome } };
    },
  };
}
