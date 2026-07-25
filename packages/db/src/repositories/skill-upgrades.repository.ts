import { skillNameKey, type EvidenceKind, type SkillLevel } from '@careerforge/core';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { type Db } from '../client.ts';
import { profileSkills } from '../schema/profile.ts';
import { skillUpgradeEvidence, skillUpgrades } from '../schema/skill-upgrades.ts';

// M3-06: skill-upgrade persistence + reads (ADR-0014). A confirmed grant that
// earns a profile skill a higher EFFECTIVE level from completed-exercise
// evidence. The ONLY module allowed SQL for these tables (routes -> services ->
// repositories). Every query is user-scoped (ADR-0007). Grants are APPEND-ONLY:
// no delete surface exists — revocation is a status flip (conditional UPDATE,
// M1-02 race-safe precedent).

export type SkillUpgradeRow = typeof skillUpgrades.$inferSelect;
export type SkillUpgradeEvidenceRow = typeof skillUpgradeEvidence.$inferSelect;

/** A grant plus its snapshotted evidence trail and the read-time `detached`
 *  flag (an ACTIVE grant whose skillNameKey matches no current profile skill —
 *  a markdown rename/removal under full-sync; OD-8). */
export interface SkillUpgradeWithEvidence {
  grant: SkillUpgradeRow;
  evidence: SkillUpgradeEvidenceRow[];
  detached: boolean;
}

/** One evidence snapshot the service captures from the source exercise at grant
 *  time (ALL of the exercise's evidence rows, not just the predicate trio). */
export interface CreateSkillUpgradeEvidenceInput {
  masteryEvidenceId: string;
  kind: EvidenceKind;
  artifactUrl: string | null;
  recordedOn: string;
}

/** The create input the service assembles after re-deriving the suggestion
 *  server-side (zero client trust): the skill snapshot + its normalization key,
 *  the from/to levels, the exercise snapshot, and the evidence trail. */
export interface CreateSkillUpgradeInput {
  profileSkillId: string;
  skillName: string;
  skillNameKey: string;
  fromLevel: SkillLevel;
  toLevel: SkillLevel;
  exerciseId: string;
  exerciseTitle: string;
  evidence: CreateSkillUpgradeEvidenceInput[];
}

/** Outcome of a revoke attempt (maps to 200 / 409 / 404 in the service). */
export type RevokeOutcome = 'revoked' | 'already_revoked' | 'not_found';

export interface SkillUpgradesRepository {
  /** Insert one grant + ALL its evidence snapshots in a single transaction. A
   *  duplicate ACTIVE grant for the same (user, skill key) violates the partial
   *  unique index and throws 23505 — the service maps it to 409 (the whole tx
   *  rolls back, no evidence orphaned). */
  createGrantWithEvidence(
    userId: string,
    input: CreateSkillUpgradeInput,
  ): Promise<SkillUpgradeWithEvidence>;

  /** All grants for the user (active + revoked) — the audit view — each with
   *  its evidence trail and the derived `detached` flag, deterministically
   *  ordered (created_at, id). */
  listGrants(userId: string): Promise<SkillUpgradeWithEvidence[]>;

  /** One grant (owner-scoped) with evidence + detached, or undefined (404). */
  findGrant(userId: string, upgradeId: string): Promise<SkillUpgradeWithEvidence | undefined>;

  /** Race-safe revoke: conditional UPDATE active->revoked. `revoked` on success,
   *  `already_revoked` if it exists but is not active (409), `not_found` (404). */
  revokeGrant(userId: string, upgradeId: string, note: string | null): Promise<RevokeOutcome>;
}

export function createSkillUpgradesRepository(db: Db): SkillUpgradesRepository {
  /** The set of skillNameKeys for the user's CURRENT profile skills — the
   *  denominator of the detached check. */
  async function currentSkillKeys(userId: string): Promise<Set<string>> {
    const rows = await db
      .select({ name: profileSkills.name })
      .from(profileSkills)
      .where(eq(profileSkills.userId, userId));
    return new Set(rows.map((row) => skillNameKey(row.name)));
  }

  function isDetached(grant: SkillUpgradeRow, keys: Set<string>): boolean {
    return grant.status === 'active' && !keys.has(grant.skillNameKey);
  }

  return {
    createGrantWithEvidence(userId, input) {
      return db.transaction(async (tx) => {
        const [grant] = await tx
          .insert(skillUpgrades)
          .values({
            userId,
            profileSkillId: input.profileSkillId,
            skillName: input.skillName,
            skillNameKey: input.skillNameKey,
            fromLevel: input.fromLevel,
            toLevel: input.toLevel,
            exerciseId: input.exerciseId,
            exerciseTitle: input.exerciseTitle,
          })
          .returning();
        if (!grant) throw new Error('skill_upgrades insert returned no rows');

        let evidence: SkillUpgradeEvidenceRow[] = [];
        if (input.evidence.length > 0) {
          evidence = await tx
            .insert(skillUpgradeEvidence)
            .values(
              input.evidence.map((row) => ({
                userId,
                skillUpgradeId: grant.id,
                masteryEvidenceId: row.masteryEvidenceId,
                kind: row.kind,
                artifactUrl: row.artifactUrl,
                recordedOn: row.recordedOn,
              })),
            )
            .returning();
        }
        // Just granted from an existing skill, so never detached at creation.
        return { grant, evidence: sortEvidence(evidence), detached: false };
      });
    },

    async listGrants(userId) {
      const grants = await db
        .select()
        .from(skillUpgrades)
        .where(eq(skillUpgrades.userId, userId))
        .orderBy(asc(skillUpgrades.createdAt), asc(skillUpgrades.id));
      if (grants.length === 0) return [];

      const evidenceRows = await db
        .select()
        .from(skillUpgradeEvidence)
        .where(
          and(
            eq(skillUpgradeEvidence.userId, userId),
            inArray(
              skillUpgradeEvidence.skillUpgradeId,
              grants.map((grant) => grant.id),
            ),
          ),
        )
        .orderBy(asc(skillUpgradeEvidence.recordedOn), asc(skillUpgradeEvidence.id));
      const byUpgrade = new Map<string, SkillUpgradeEvidenceRow[]>();
      for (const row of evidenceRows) {
        const list = byUpgrade.get(row.skillUpgradeId);
        if (list) list.push(row);
        else byUpgrade.set(row.skillUpgradeId, [row]);
      }

      const keys = await currentSkillKeys(userId);
      return grants.map((grant) => ({
        grant,
        evidence: byUpgrade.get(grant.id) ?? [],
        detached: isDetached(grant, keys),
      }));
    },

    async findGrant(userId, upgradeId) {
      const [grant] = await db
        .select()
        .from(skillUpgrades)
        .where(and(eq(skillUpgrades.userId, userId), eq(skillUpgrades.id, upgradeId)))
        .limit(1);
      if (!grant) return undefined;
      const evidence = await db
        .select()
        .from(skillUpgradeEvidence)
        .where(
          and(
            eq(skillUpgradeEvidence.userId, userId),
            eq(skillUpgradeEvidence.skillUpgradeId, upgradeId),
          ),
        )
        .orderBy(asc(skillUpgradeEvidence.recordedOn), asc(skillUpgradeEvidence.id));
      const keys = await currentSkillKeys(userId);
      return { grant, evidence, detached: isDetached(grant, keys) };
    },

    async revokeGrant(userId, upgradeId, note) {
      const updated = await db
        .update(skillUpgrades)
        .set({ status: 'revoked', revokedAt: sql`now()`, revokeNote: note })
        .where(
          and(
            eq(skillUpgrades.userId, userId),
            eq(skillUpgrades.id, upgradeId),
            eq(skillUpgrades.status, 'active'),
          ),
        )
        .returning({ id: skillUpgrades.id });
      if (updated.length > 0) return 'revoked';
      // 0 rows: either the grant does not exist (404) or it is not active (409).
      const [exists] = await db
        .select({ id: skillUpgrades.id })
        .from(skillUpgrades)
        .where(and(eq(skillUpgrades.userId, userId), eq(skillUpgrades.id, upgradeId)))
        .limit(1);
      return exists ? 'already_revoked' : 'not_found';
    },
  };
}

/** Evidence in a canonical order for the wire, regardless of insert order. */
function sortEvidence(rows: SkillUpgradeEvidenceRow[]): SkillUpgradeEvidenceRow[] {
  return [...rows].sort((a, b) => {
    if (a.recordedOn !== b.recordedOn) return a.recordedOn < b.recordedOn ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
