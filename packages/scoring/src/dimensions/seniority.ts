import { tokenizeForMatching, type EvidenceLink, type SubScore } from '@careerforge/core';

import { demandedYears, professionalSpanYears } from '../evaluators/seniority-threshold.ts';
import { clamp01, mean, phraseMatches, round4 } from '../matching.ts';
import { type PreparedInput } from '../prepare.ts';
import { matchedSlugs } from './coverage-signal.ts';

// seniority — seniority-category requirements vs the profile's computed
// professional span and titles, blended 0.7/0.3 with role+scope signal
// matches (the D-mapping: role + scope -> seniority). The span is computed
// ONLY from input dates and the caller-supplied referenceDate (PG now(), the
// one-clock convention) — the engine has no clock, and the rationale ALWAYS
// states the reference date so the report stays self-explaining.
//
// M12-02 (F3): demandedYears + professionalSpanYears moved to
// ../evaluators/seniority-threshold.ts so the gap classifier consumes the SAME
// comparison - this dimension is their other consumer. D-8: the years-met
// evidence link stays `adjacent` (the strength law reserves `direct` for a
// named skill; this proof is experience-anchored) - the honest strength change
// is deferred to the parked skill-model split. See the years-met branch below.

export function scoreSeniority(prepared: PreparedInput): SubScore {
  const relevant = prepared.eligible.filter((requirement) => requirement.category === 'seniority');
  const span = professionalSpanYears(prepared.experiences, prepared.referenceDate);
  const spanNote = `computed professional span ~${String(span)} years as of ${prepared.referenceDate}`;

  if (relevant.length === 0) {
    return {
      dimension: 'seniority',
      score: 0.5,
      rationale: `No seniority requirements extracted - neutral 0.5 (${spanNote}).`,
      evidence: [],
    };
  }

  const roleAndScope = [
    ...prepared.criteria.positiveSignals.role,
    ...prepared.criteria.positiveSignals.scope,
  ];
  const mostRecent = prepared.experiences[prepared.experiences.length - 1];

  const notes: string[] = [];
  const evidence: EvidenceLink[] = [];
  const coverages = relevant.map((requirement) => {
    const tokens = prepared.requirementTokens.get(requirement.id) ?? [];
    const demanded = demandedYears(tokens);
    if (demanded !== undefined) {
      if (span >= demanded && mostRecent) {
        notes.push(`${String(demanded)}+ years demanded, span ~${String(span)} meets it`);
        evidence.push({
          requirementId: requirement.id,
          profileSkillId: null,
          profileProjectId: null,
          profileExperienceId: mostRecent.id,
          postingQuote: requirement.sourceQuote,
          profileQuote: `${mostRecent.title} at ${mostRecent.company}; span ~${String(span)} yrs as of ${prepared.referenceDate}`,
          // D-8 note (M12-02): this experience-anchored proof stays `adjacent`.
          // The evidence-strength law (core enums) reserves `direct` for a NAMED
          // profile skill (fitReportDataSchema refines "direct evidence requires
          // a named profile skill"), and this link carries profileExperienceId,
          // not profileSkillId. Giving a threshold proof its own "strong" slot
          // needs an evidence-model change - deferred to the parked skill-model
          // split, where the correctness-arc D-8 broader answer already lives.
          // F3 is unaffected: the classifier emits satisfied_fact from this same
          // threshold.
          strength: 'adjacent',
        });
        return 1;
      }
      notes.push(`${String(demanded)}+ years demanded, span ~${String(span)} falls short`);
      return 0;
    }
    // No year figure: a role-vocabulary bridge (requirement <-> a title).
    const bridging = roleAndScope.find((slug) => {
      const slugTokens = tokenizeForMatching(slug);
      return (
        phraseMatches(tokens, slugTokens) &&
        prepared.experiences.some((experience) =>
          phraseMatches(tokenizeForMatching(experience.title), slugTokens),
        )
      );
    });
    if (bridging !== undefined && mostRecent) {
      const matchedExperience = prepared.experiences.find((experience) =>
        phraseMatches(tokenizeForMatching(experience.title), tokenizeForMatching(bridging)),
      )!;
      notes.push(`title evidence for "${bridging}"`);
      evidence.push({
        requirementId: requirement.id,
        profileSkillId: null,
        profileProjectId: null,
        profileExperienceId: matchedExperience.id,
        postingQuote: requirement.sourceQuote,
        profileQuote: `${matchedExperience.title} at ${matchedExperience.company}`,
        strength: 'adjacent',
      });
      return 0.25;
    }
    notes.push('no year figure or title evidence');
    return 0;
  });

  const coverage = round4(mean(coverages));
  const matched = matchedSlugs(prepared, roleAndScope);
  const signalRatio = round4(matched.length / Math.max(roleAndScope.length, 1));
  const score = round4(clamp01(0.7 * coverage + 0.3 * signalRatio));
  return {
    dimension: 'seniority',
    score,
    rationale:
      `Seniority coverage ${String(coverage)} over ${String(relevant.length)} requirement(s) ` +
      `[${notes.join('; ')}]; ${String(matched.length)} of ${String(roleAndScope.length)} ` +
      `role/scope signals matched; ${spanNote}.`,
    evidence,
  };
}
