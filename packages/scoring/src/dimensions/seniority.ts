import { tokenizeForMatching, type EvidenceLink, type SubScore } from '@careerforge/core';

import { clamp01, mean, phraseMatches, round4 } from '../matching.ts';
import { type PreparedInput } from '../prepare.ts';
import { matchedSlugs } from './coverage-signal.ts';

// seniority — seniority-category requirements vs the profile's computed
// professional span and titles, blended 0.7/0.3 with role+scope signal
// matches (the D-mapping: role + scope -> seniority). The span is computed
// ONLY from input dates and the caller-supplied referenceDate (PG now(), the
// one-clock convention) — the engine has no clock, and the rationale ALWAYS
// states the reference date so the report stays self-explaining.

/** days-from-civil (Howard Hinnant's algorithm): ISO date -> day serial.
 *  Pure integer math — no Date object anywhere in this package. */
function dayNumber(isoDate: string): number {
  const [yearRaw, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const year = month <= 2 ? yearRaw - 1 : yearRaw;
  const era = Math.floor(year / 400);
  const yoe = year - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe;
}

/** Total professional span in years: experience intervals (endDate NULL =
 *  open, closed at referenceDate), overlap-merged so concurrent roles never
 *  double-count, to one decimal. */
export function professionalSpanYears(
  experiences: PreparedInput['experiences'],
  referenceDate: string,
): number {
  const reference = dayNumber(referenceDate);
  const intervals = experiences
    .map((experience) => ({
      start: dayNumber(experience.startDate),
      end: Math.min(dayNumber(experience.endDate ?? referenceDate), reference),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  let days = 0;
  let currentStart: number | undefined;
  let currentEnd = 0;
  for (const interval of intervals) {
    if (currentStart === undefined || interval.start > currentEnd) {
      if (currentStart !== undefined) days += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    } else {
      currentEnd = Math.max(currentEnd, interval.end);
    }
  }
  if (currentStart !== undefined) days += currentEnd - currentStart;
  return Math.round((days / 365.25) * 10) / 10;
}

/** First "N+ years" / "N years" figure in the requirement tokens (1-2 digit
 *  N followed by a year token within gap 1), or undefined. */
export function demandedYears(tokens: readonly string[]): number | undefined {
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    if (!/^\d{1,2}$/.test(token)) continue;
    const next = tokens[index + 1]!;
    const after = tokens[index + 2];
    if (/^years?$/.test(next) || (after !== undefined && /^years?$/.test(after))) {
      return Number(token);
    }
  }
  return undefined;
}

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
