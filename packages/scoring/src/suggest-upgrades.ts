import {
  skillNameKey,
  tokenizeForMatching,
  type EvidenceKind,
  type SkillLevel,
  type SkillUpgradeSuggestion,
} from '@careerforge/core';

import { phraseMatches } from './matching.ts';

// M3-06 — deterministic upgrade suggestions (Evidence → profile upgrades,
// ADR-0014). PURE like scoreFit/classifyGaps: no I/O, no clock, no randomness —
// the api service assembles the inputs (completed exercises + their evidence
// kinds + gap-joined requirements, and the profile skills with their EFFECTIVE
// levels) and this function derives which skills an exercise's evidence would
// earn a `solid` grant for. Nothing is stored; the api recomputes per request
// (GET) and re-derives at confirm time (POST) from this one definition.
//
// This is the FIRST consumer of matching.ts (phraseMatches / tokenizeForMatching)
// outside the fit engine — borrowed READ-ONLY. If the matcher's semantics are
// ever loosened for the fit engine's needs, fork a private copy here rather than
// let a fit-engine tuning silently shift which upgrades get suggested (the
// M3-01 normalizeWhitespace-borrow precedent). Inherited residual, documented
// not fixed: phraseMatches has no stopword list, so a one-token skill like "Go"
// or "R" at a suggestible level matches incidental words in requirement text
// (identical to M1-09 fit evidence) — the confirmation gate is the filter.

/**
 * The FULL-EVIDENCE predicate (OD-3): an exercise is upgrade-eligible only with
 * ≥1 `implemented` AND ≥1 `tested` AND ≥1 `explained` — all three ACQUISITION
 * kinds. `revisited` (M3-05's retention axis) is deliberately excluded: it is
 * only recordable ≥7 days post-completion and would time-lock every upgrade.
 * Checked for EXISTENCE, not count (a kind may recur). The SOLE definition —
 * the POST re-derivation enforces the same predicate by calling this engine.
 */
export function hasFullMasteryEvidence(kinds: ReadonlySet<EvidenceKind>): boolean {
  return kinds.has('implemented') && kinds.has('tested') && kinds.has('explained');
}

/** Only rusty|learning skills are suggestible (OD-4): expert|solid already sit
 *  at or above the earned `solid` target, and `rusty` (past competence gone
 *  stale) is unreachable from fresh exercise evidence — solid is the only
 *  coherent earned target from either suggestible start. */
const SUGGESTIBLE_LEVELS: ReadonlySet<SkillLevel> = new Set<SkillLevel>(['rusty', 'learning']);

/** The earned target is always `solid` (OD-4). */
const EARNED_TARGET: SkillLevel = 'solid';

export interface SuggestUpgradesSkill {
  id: string;
  name: string;
  /** The skill's EFFECTIVE level today (max of declared + active grants). */
  effectiveLevel: SkillLevel;
}

export interface SuggestUpgradesRequirement {
  gapId: string;
  requirementId: string;
  /** Requirement text — matched against the skill name; surfaced in the
   *  suggestion (escaped on display) but NEVER persisted into a grant. */
  text: string;
  /** The posting quote that justified the requirement; part of the match
   *  haystack, mirroring the fit engine (prepare.ts). */
  sourceQuote: string;
}

export interface SuggestUpgradesExercise {
  id: string;
  title: string;
  /** ISO YYYY-MM-DD completion date (a complete exercise always has one — the
   *  0014 CHECK). Lexical order == chronological for this format. */
  completedOn: string;
  evidenceKinds: ReadonlySet<EvidenceKind>;
  requirements: SuggestUpgradesRequirement[];
}

export interface SuggestUpgradesInput {
  skills: SuggestUpgradesSkill[];
  exercises: SuggestUpgradesExercise[];
}

/**
 * Derive the upgrade suggestions for a profile. For each exercise passing the
 * full-evidence predicate, and each suggestible skill whose name phrase-matches
 * one of the exercise's requirements (text + quote, exactly the fit engine's
 * haystack), emit a per-skill suggestion grouping every backing exercise and
 * the requirements that matched within it.
 *
 * Determinism (the (dueOn, id) law): skills by skillNameKey asc then id;
 * exercises within a skill by completedOn asc then id; matched requirements by
 * requirementId asc. A skill with no matched exercise is omitted entirely (no
 * empty suggestions).
 */
export function suggestSkillUpgrades(input: SuggestUpgradesInput): SkillUpgradeSuggestion[] {
  const suggestible = input.skills.filter((skill) => SUGGESTIBLE_LEVELS.has(skill.effectiveLevel));
  if (suggestible.length === 0) return [];

  const eligibleExercises = input.exercises.filter((exercise) =>
    hasFullMasteryEvidence(exercise.evidenceKinds),
  );
  if (eligibleExercises.length === 0) return [];

  const suggestions: SkillUpgradeSuggestion[] = [];

  for (const skill of suggestible) {
    const skillTokens = tokenizeForMatching(skill.name);
    const exercises: SkillUpgradeSuggestion['exercises'] = [];

    for (const exercise of eligibleExercises) {
      const matchedRequirements = exercise.requirements
        .filter((requirement) =>
          phraseMatches(
            tokenizeForMatching(`${requirement.text} ${requirement.sourceQuote}`),
            skillTokens,
          ),
        )
        .map((requirement) => ({
          gapId: requirement.gapId,
          requirementId: requirement.requirementId,
          text: requirement.text,
        }))
        .sort((a, b) =>
          a.requirementId < b.requirementId ? -1 : a.requirementId > b.requirementId ? 1 : 0,
        );

      if (matchedRequirements.length === 0) continue;
      exercises.push({
        exerciseId: exercise.id,
        title: exercise.title,
        completedOn: exercise.completedOn,
        matchedRequirements,
      });
    }

    if (exercises.length === 0) continue;
    exercises.sort((a, b) => {
      if (a.completedOn !== b.completedOn) return a.completedOn < b.completedOn ? -1 : 1;
      return a.exerciseId < b.exerciseId ? -1 : a.exerciseId > b.exerciseId ? 1 : 0;
    });

    suggestions.push({
      profileSkillId: skill.id,
      skillName: skill.name,
      currentLevel: skill.effectiveLevel,
      suggestedLevel: EARNED_TARGET,
      exercises,
    });
  }

  suggestions.sort((a, b) => {
    const ka = skillNameKey(a.skillName);
    const kb = skillNameKey(b.skillName);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.profileSkillId < b.profileSkillId ? -1 : a.profileSkillId > b.profileSkillId ? 1 : 0;
  });

  return suggestions;
}
