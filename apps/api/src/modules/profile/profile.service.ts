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
import { computeSourceFingerprint, type FingerprintSources } from './import-fingerprint.ts';
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

/**
 * M13-09 (F-7): what a destructive import WOULD do, computed without writing.
 * `destructive` is true iff any section (profile OR facts) would DELETE a row -
 * the trigger for the confirm gate. `fingerprint` is the CAS token the caller
 * echoes back as `confirmDeletes`. `totals` are the CURRENT (pre-import) counts.
 */
export interface ImportPreview {
  sync: ProfileSyncSummary;
  facts: FactsSyncSummary;
  totals: ProfileCounts;
  destructive: boolean;
  fingerprint: string;
}

export interface GuardedImportOptions extends ProfileImportOptions {
  /** The fingerprint from a prior previewImport. A destructive import is
   *  REJECTED unless this equals the fingerprint recomputed at execution
   *  (same-snapshot CAS: the sources must not have changed since the preview). */
  confirmDeletes?: string;
  /** CLI --no-snapshot ONLY: proceed with a destructive import without the
   *  pre-destructive docs/profile/ snapshot. A visible operator override; the
   *  HTTP route never sets it (D4 - destructive HTTP is directed to the CLI). */
  skipSnapshot?: boolean;
}

/** Why a guarded destructive import was refused (D2 single decision point). The
 *  ingress maps this to a 409-class envelope / CLI message - counts + fingerprints
 *  only, never profile content. */
export type ImportConfirmationReason = 'confirmation_required' | 'fingerprint_mismatch';

export class ImportConfirmationError extends Error {
  readonly code = 'import_confirmation_required';
  readonly reason: ImportConfirmationReason;
  /** The fingerprint of the CURRENT sources - what the caller must echo. */
  readonly fingerprint: string;
  // Explicit fields + body assignment (NOT constructor parameter properties):
  // the CLIs run under Node's strip-only TypeScript, which rejects parameter
  // properties - the cli-smoke tripwire guards exactly this.
  constructor(reason: ImportConfirmationReason, fingerprint: string) {
    super(
      reason === 'confirmation_required'
        ? 'this import would DELETE profile rows - re-run with the previewed confirmation'
        : 'the profile sources changed since the preview - re-preview and confirm again',
    );
    this.name = 'ImportConfirmationError';
    this.reason = reason;
    this.fingerprint = fingerprint;
  }
}

/** The pre-destructive snapshot could not be taken (D4 fail-closed). The CLI
 *  offers --no-snapshot; the HTTP route maps this to "run via the CLI". */
export class SnapshotUnavailableError extends Error {
  readonly code = 'import_snapshot_unavailable';
  constructor(detail: string) {
    // `detail` comes from the snapshot script, which prints value-free messages
    // only (BACKUP_DIR paths / counts), never profile content.
    super(`could not snapshot docs/profile/ before a destructive import: ${detail}`);
    this.name = 'SnapshotUnavailableError';
  }
}

export interface ProfileImportService {
  /** Parses the profile directory and mirrors it into the user's rows. RAW: no
   *  delete guard (the --example / test bypass path, IN3). HTTP and the real CLI
   *  path go through previewImport + importGuarded instead. */
  importProfile(userId: string, options?: ProfileImportOptions): Promise<ProfileImportSummary>;
  /** M13-09: what an import WOULD change, computed by the rolled-back seam, plus
   *  the CAS fingerprint. Writes nothing. */
  previewImport(userId: string): Promise<ImportPreview>;
  /**
   * M13-09: the guarded import - the SINGLE decision point (D2). Re-reads the
   * sources ONCE (same-snapshot law), decides destructiveness via the rolled-back
   * preview, and for a destructive import REQUIRES a matching `confirmDeletes`
   * fingerprint AND (unless skipSnapshot) a successful pre-destructive snapshot
   * before it commits. A non-destructive import proceeds exactly like importProfile.
   */
  importGuarded(userId: string, options?: GuardedImportOptions): Promise<ProfileImportSummary>;
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
  /** M13-09 (F-7): take a pre-destructive snapshot of docs/profile/ (the CLI/route
   *  wire it to the db-backup --profile-only flow). MUST reject on failure. When
   *  omitted, a guarded destructive import fails closed (SnapshotUnavailableError)
   *  unless the caller passes skipSnapshot. Never called for --example/non-
   *  destructive imports. */
  snapshotProfile?: () => Promise<void>;
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

  /**
   * Read the four required sources + the optional facts.md ONCE and parse them
   * all-or-nothing (M0-08/M12-03: one attempt surfaces every fix; a failed parse
   * writes nothing). The same in-memory bytes feed the fingerprint AND the parse
   * (M13-09 same-snapshot law: hash-then-use, never hash-then-reread - the PR#11
   * check-then-act lesson applied to file bytes).
   */
  async function readAndParse(): Promise<ParsedImport> {
    const [resume, skills, projects, criteriaSource, factsSource] = await Promise.all([
      readSource(PROFILE_SOURCE_FILES.resume),
      readSource(PROFILE_SOURCE_FILES.skills),
      readSource(PROFILE_SOURCE_FILES.projects),
      readSource(PROFILE_SOURCE_FILES.criteria),
      readOptionalSource(PROFILE_FACTS_FILE),
    ]);

    const issues: ParseIssue[] = [];
    let profileData: ParsedProfile | null = null;
    try {
      profileData = parseProfile({ resume, skills, projects });
    } catch (error) {
      if (!(error instanceof ProfileParseError)) throw error;
      issues.push(...error.issues);
    }
    const criteriaData = parseCriteria(criteriaSource, issues);
    // Optional facts.md (M12-03): absent -> []; present-but-broken -> undefined
    // (issues populated -> throw below); present-and-clean -> the parsed facts.
    const factsData: ProfileFactImport[] | undefined =
      factsSource === null ? [] : parseFacts(factsSource, issues);
    if (profileData === null || criteriaData === undefined || factsData === undefined) {
      throw new ProfileParseError(issues);
    }
    return {
      raw: { resume, skills, projects, criteria: criteriaSource, facts: factsSource },
      profileData,
      criteriaData,
      factsData,
    };
  }

  /** The real, committing mirror - shared by importProfile (raw) and the guarded
   *  path once its checks pass. Criteria runs AFTER the table sync so a
   *  skipped_existing criteria row never blocks the tables from mirroring. */
  async function executeSync(
    userId: string,
    parsed: ParsedImport,
    forceCriteria: boolean,
  ): Promise<ProfileImportSummary> {
    const sync = await deps.profile.syncProfile(userId, parsed.profileData);
    const facts = await deps.facts.syncFacts(userId, parsed.factsData);
    const totals = await deps.profile.countsFor(userId);
    const outcome = await syncCriteria(userId, parsed.criteriaData, forceCriteria);
    return { sync, facts, totals, criteria: { outcome } };
  }

  return {
    async importProfile(userId, options = {}) {
      return executeSync(userId, await readAndParse(), options.forceCriteria === true);
    },

    async previewImport(userId) {
      const parsed = await readAndParse();
      const fingerprint = computeSourceFingerprint(parsed.raw);
      const sync = await deps.profile.previewSyncProfile(userId, parsed.profileData);
      const facts = await deps.facts.previewSyncFacts(userId, parsed.factsData);
      const totals = await deps.profile.countsFor(userId);
      return { sync, facts, totals, destructive: anyDeleted(sync, facts), fingerprint };
    },

    async importGuarded(userId, options = {}) {
      const parsed = await readAndParse();
      const fingerprint = computeSourceFingerprint(parsed.raw);
      // Decide destructiveness from a FRESH rolled-back preview - never trust a
      // client-supplied flag; the CAS is re-derived server-side every time.
      const previewSync = await deps.profile.previewSyncProfile(userId, parsed.profileData);
      const previewFacts = await deps.facts.previewSyncFacts(userId, parsed.factsData);
      if (anyDeleted(previewSync, previewFacts)) {
        if (!options.confirmDeletes) {
          throw new ImportConfirmationError('confirmation_required', fingerprint);
        }
        if (options.confirmDeletes !== fingerprint) {
          throw new ImportConfirmationError('fingerprint_mismatch', fingerprint);
        }
        if (options.skipSnapshot !== true) {
          if (!deps.snapshotProfile) {
            throw new SnapshotUnavailableError('no snapshot capability is configured');
          }
          try {
            await deps.snapshotProfile();
          } catch (error) {
            if (error instanceof SnapshotUnavailableError) throw error;
            throw new SnapshotUnavailableError(
              error instanceof Error ? error.message : String(error),
            );
          }
        }
      }
      return executeSync(userId, parsed, options.forceCriteria === true);
    },
  };
}

/** The parsed sources + the raw bytes for fingerprinting (same-snapshot law). */
interface ParsedImport {
  raw: FingerprintSources;
  profileData: ParsedProfile;
  criteriaData: SearchCriteriaData;
  factsData: ProfileFactImport[];
}

/** Destructive = any section (profile OR facts) would DELETE a row. contact is
 *  upsert-only (deleted always 0) but included for completeness. */
function anyDeleted(sync: ProfileSyncSummary, facts: FactsSyncSummary): boolean {
  return (
    sync.skills.deleted > 0 ||
    sync.experiences.deleted > 0 ||
    sync.projects.deleted > 0 ||
    sync.bullets.deleted > 0 ||
    sync.contact.deleted > 0 ||
    sync.summaries.deleted > 0 ||
    sync.education.deleted > 0 ||
    facts.deleted > 0
  );
}
