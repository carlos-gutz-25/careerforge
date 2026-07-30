import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';

import { type ProfileFact, type SearchCriteriaData } from '@careerforge/core';
import {
  type FactsSyncSummary,
  type ProfileCounts,
  type ProfileData,
  type ProfileFactImport,
  type ProfileFactsRepository,
  type ProfileRepository,
  type ProfileSyncSummary,
  type SearchCriteriaRepository,
} from '@careerforge/db';

import { parseCriteria } from '../criteria/criteria-parser.ts';
import { parseFacts } from './facts-parser.ts';
import { ProfileParseError, type ParseIssue } from './parse-errors.ts';
import { parseProfile, type ParsedProfile, type SourceFile } from './profile-parser.ts';

export const PROFILE_SOURCE_FILES = {
  resume: 'resume.md',
  skills: 'skills.md',
  projects: 'projects.md',
  criteria: 'job-criteria.md',
} as const;

// M12-03: facts.md is OPTIONAL (unlike the four required sources above). A
// profile without it imports cleanly, and the full-sync then treats "no file"
// as "no declared facts" (D-4: the file is the source of truth).
export const PROFILE_FACTS_FILE = 'facts.md';

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
  /** What the facts.md full-sync changed (M12-03). All-zero = idempotent. */
  facts: FactsSyncSummary;
  /** Row counts after the import (the "profile is populated" evidence). */
  totals: ProfileCounts;
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
  /** The user's declared facts for GET /profile/facts (M12-03), mapped to the
   *  wire shape (dates as ISO strings). Read-only; facts.md is the source. */
  listFacts(userId: string): Promise<ProfileFact[]>;
}

/**
 * Deliberate passthrough (approved shape 2026-07-15): the repository owns
 * row ordering, the route's response schema (packages/core) owns the wire
 * shape — no view shaping in between. `listFacts` is the one exception: it
 * maps the DB row's timestamptz `updatedAt` to an ISO string for the wire
 * (the date column `declaredAt` already travels as YYYY-MM-DD). Fact VALUES
 * are never logged here — only returned to the escaped Evidence Library view.
 */
export function createProfileService(deps: {
  profile: ProfileRepository;
  facts: ProfileFactsRepository;
}): ProfileService {
  return {
    getProfile: (userId) => deps.profile.getProfile(userId),
    async listFacts(userId) {
      const rows = await deps.facts.listFacts(userId);
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        value: row.value,
        note: row.note,
        declaredAt: row.declaredAt,
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
  };
}

export function createProfileImportService(deps: {
  /** Directory holding resume.md / skills.md / projects.md / job-criteria.md
   *  (and the OPTIONAL facts.md, M12-03). */
  profileDir: string;
  profile: ProfileRepository;
  facts: ProfileFactsRepository;
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

  /** Like readSource, but a MISSING file is not an error — returns null. Used
   *  for the optional facts.md (M12-03): absence = "no declared facts". */
  async function readOptionalSource(name: string): Promise<SourceFile | null> {
    try {
      return { name, content: await readFile(path.join(deps.profileDir, name), 'utf8') };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null;
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
      const [resume, skills, projects, criteriaSource, factsSource] = await Promise.all([
        readSource(PROFILE_SOURCE_FILES.resume),
        readSource(PROFILE_SOURCE_FILES.skills),
        readSource(PROFILE_SOURCE_FILES.projects),
        readSource(PROFILE_SOURCE_FILES.criteria),
        readOptionalSource(PROFILE_FACTS_FILE),
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
      // Optional facts.md (M12-03): absent → []; present-but-broken → undefined
      // (issues populated → throw below); present-and-clean → the parsed facts.
      const factsData: ProfileFactImport[] | undefined =
        factsSource === null ? [] : parseFacts(factsSource, issues);
      if (profileData === null || criteriaData === undefined || factsData === undefined) {
        throw new ProfileParseError(issues);
      }

      const sync = await deps.profile.syncProfile(userId, profileData);
      // Facts full-sync (M12-03): the file is the source of truth, so an absent
      // or shrunk facts.md deletes the missing kinds (D-4). Idempotent.
      const facts = await deps.facts.syncFacts(userId, factsData);
      const totals = await deps.profile.countsFor(userId);
      // Criteria AFTER the table sync: a skipped_existing criteria row never
      // blocks the profile tables from mirroring their sources.
      const outcome = await syncCriteria(userId, criteriaData, options.forceCriteria === true);
      return { sync, facts, totals, criteria: { outcome } };
    },
  };
}
