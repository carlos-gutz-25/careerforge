// demo:seed replay/remap, against the dockerized test DB (M10-03 slice 6b).
// Drives runDemoSeed with the COMMITTED fixture: replays the captured
// extractions, recomputes fit live, and inserts the 5 artifacts re-linked to
// the recomputed graph by identity — no provider, no key. Verifies: the whole
// pipeline runs; the operator-approved reviewed/draft split lands in the DB;
// the seed is rerun-twice-identical (idempotent); and the amendment-3 data
// refusal fires. All inputs fictional (RISKS P-01).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDemoSeedStateRepository,
  createImprovementPlansRepository,
  createPostingsRepository,
  createResumeVariantsRepository,
  createUsersRepository,
  type DemoSeedMarker,
} from '@careerforge/db';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';

import { DemoSeedRefusedError, runDemoSeed } from './seed.ts';

const handle = createTestDb();
const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const profileDir = path.join(repoRoot, 'docs/profile.example');
const fixturesDir = path.join(repoRoot, 'apps/api/src/cli/demo/fixtures');
const fixtureSet: unknown = JSON.parse(
  readFileSync(path.join(fixturesDir, 'demo-fixture-set.json'), 'utf8'),
);
const manifestFile = JSON.parse(readFileSync(path.join(fixturesDir, 'manifest.json'), 'utf8')) as {
  fixtureSetVersion: string;
  fixtureManifestSha256: string;
};
const manifest: DemoSeedMarker = {
  fixtureSetVersion: manifestFile.fixtureSetVersion,
  fixtureManifestSha256: manifestFile.fixtureManifestSha256,
};

let userCounter = 0;
async function makeUser(): Promise<string> {
  userCounter += 1;
  const user = await createUsersRepository(handle.db).create({
    email: `demo-bootstrap-${String(userCounter)}@example.com`,
    passwordHash: 'unverifiable-by-design',
  });
  return user.id;
}

describe('demo:seed (replay + remap, keyless)', () => {
  beforeEach(() => truncateAllTables(handle));
  afterAll(() => handle.pool.end());

  it('seeds every artifact with the reviewed/draft split and is rerun-twice-identical', async () => {
    const userId = await makeUser();
    const first = await runDemoSeed({ db: handle.db, userId, fixtureSet, manifest, profileDir });

    // The whole pipeline ran: 4 postings replayed, fit recomputed, gaps present.
    expect(first.postings).toBe(4);
    expect(first.fitReports).toBe(4);
    expect(first.requirements).toBeGreaterThan(0);
    expect(first.gaps).toBeGreaterThan(0);

    // The operator-approved split (3 reviewed / 2 draft; interview-prep absent).
    const split = Object.fromEntries(first.artifacts.map((a) => [a.family, a.reviewStatus]));
    expect(split).toEqual({
      improvementPlan: 'reviewed',
      gameplan: 'reviewed',
      resumeDocument: 'reviewed',
      learningPlan: 'draft',
      resumeVariant: 'draft',
    });

    // The split actually LANDED in the DB (not just summary bookkeeping).
    const plan = await createImprovementPlansRepository(handle.db).findPlanForReport(
      userId,
      first.strongestReportId,
    );
    expect(plan?.plan.reviewStatus).toBe('reviewed');
    const variant = await createResumeVariantsRepository(handle.db).findVariantForReport(
      userId,
      first.strongestReportId,
    );
    expect(variant?.variant.reviewStatus).toBe('draft');

    // The marker was written last.
    const marker = await createDemoSeedStateRepository(handle.db).read();
    expect(marker?.fixtureSetVersion).toBe(manifest.fixtureSetVersion);

    // Rerun on the same DB: identical STATE (idempotent rebuild). The marker
    // now exists, so the amendment-3 refusal is skipped and the graph is
    // delete-and-reinserted. Fresh UUIDs (strongestReportId) legitimately differ
    // each run — fit recompute mints new ids — so compare the id-independent
    // counts + artifact split.
    const second = await runDemoSeed({ db: handle.db, userId, fixtureSet, manifest, profileDir });
    const stable = (s: typeof first) => ({
      postings: s.postings,
      requirements: s.requirements,
      fitReports: s.fitReports,
      gaps: s.gaps,
      artifacts: s.artifacts,
    });
    expect(stable(second)).toEqual(stable(first));
  }, 90_000);

  it('refuses (amendment 3) when the user has data but no demo marker', async () => {
    const userId = await makeUser();
    // A row with no demo_seed_state marker = not a demo-owned instance.
    await createPostingsRepository(handle.db).ingest(userId, {
      rawText: 'A real posting that demo:seed must never clobber.',
      contentHash: createHash('sha256').update('real').digest('hex'),
      company: 'Real Co',
      title: 'Real Role',
      sourceNote: null,
    });
    await expect(
      runDemoSeed({ db: handle.db, userId, fixtureSet, manifest, profileDir }),
    ).rejects.toBeInstanceOf(DemoSeedRefusedError);
  }, 30_000);
});
