import { type ProfileExperience } from '@careerforge/core';

// M12-02 (F3 fix): the SHARED seniority years-threshold evaluator. demandedYears()
// (per-requirement) and professionalSpanYears() (per-profile) were born in
// dimensions/seniority.ts and lived only there, so the fit DIMENSION computed the
// comparison but the gap CLASSIFIER never saw it - a requirement could score
// satisfied AND classify genuine_gap. Extracted here as the ONE source of truth
// both consume. Pure integer math - no Date object, no clock, no randomness (the
// packages/scoring determinism wall); the caller always supplies referenceDate.

/** days-from-civil (Howard Hinnant's algorithm): ISO date -> day serial.
 *  Pure integer math - no Date object anywhere in this package. */
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
  experiences: readonly ProfileExperience[],
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

/** The result of evaluating a seniority requirement's years threshold. */
export interface SeniorityThreshold {
  /** The demanded "N years" figure parsed from the requirement. */
  demanded: number;
  /** The profile's overlap-merged professional span (years, one decimal). */
  span: number;
  /** span >= demanded - a deterministic numeric proof, either direction. */
  satisfied: boolean;
}

/**
 * Evaluate a seniority requirement's years threshold, or `undefined` when the
 * requirement states NO "N years" figure (there is nothing to compare - the
 * classifier maps that to `unknown`, and the dimension falls back to its
 * role-vocabulary bridge). When a figure is present this is the single
 * comparison both the seniority dimension and the gap classifier consume, so
 * they can never disagree about whether the threshold is met (F3).
 */
export function evaluateSeniorityThreshold(
  requirementTokens: readonly string[],
  experiences: readonly ProfileExperience[],
  referenceDate: string,
): SeniorityThreshold | undefined {
  const demanded = demandedYears(requirementTokens);
  if (demanded === undefined) return undefined;
  const span = professionalSpanYears(experiences, referenceDate);
  return { demanded, span, satisfied: span >= demanded };
}
