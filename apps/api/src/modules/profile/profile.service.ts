import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { type ProfileRepository, type ProfileSyncSummary } from '@careerforge/db';

import { ProfileParseError } from './parse-errors.ts';
import { parseProfile, type SourceFile } from './profile-parser.ts';

export const PROFILE_SOURCE_FILES = {
  resume: 'resume.md',
  skills: 'skills.md',
  projects: 'projects.md',
} as const;

export interface ProfileImportSummary {
  /** What this import changed, per table. All-zero = idempotent re-import. */
  sync: ProfileSyncSummary;
  /** Row counts after the import (the "profile is populated" evidence). */
  totals: { skills: number; experiences: number; projects: number };
}

export interface ProfileImportService {
  /** Parses the profile directory and mirrors it into the user's rows. */
  importProfile(userId: string): Promise<ProfileImportSummary>;
}

export function createProfileImportService(deps: {
  /** Directory holding resume.md / skills.md / projects.md. */
  profileDir: string;
  profile: ProfileRepository;
}): ProfileImportService {
  async function readSource(name: string): Promise<SourceFile> {
    try {
      return { name, content: await readFile(path.join(deps.profileDir, name), 'utf8') };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new ProfileParseError([
          { file: name, line: 1, message: `file not found in the profile directory` },
        ]);
      }
      throw error;
    }
  }

  return {
    async importProfile(userId) {
      const [resume, skills, projects] = await Promise.all([
        readSource(PROFILE_SOURCE_FILES.resume),
        readSource(PROFILE_SOURCE_FILES.skills),
        readSource(PROFILE_SOURCE_FILES.projects),
      ]);
      const parsed = parseProfile({ resume, skills, projects });
      const sync = await deps.profile.syncProfile(userId, parsed);
      const totals = await deps.profile.countsFor(userId);
      return { sync, totals };
    },
  };
}
