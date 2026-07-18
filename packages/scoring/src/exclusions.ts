import {
  HARD_FILTER_KEYS,
  tokenizeForMatching,
  type ExclusionVerdict,
  type HardFilterKey,
  type ScoringRequirement,
} from '@careerforge/core';

import { parseCompRange } from './comp-parse.ts';
import { phraseMatches } from './matching.ts';
import { type PreparedInput } from './prepare.ts';

// Hard-filter evaluation (M1-08 domain law -> M1-09): a fired filter is an
// EXPLICIT exclusion verdict, never a silent low score. Conservative-evidence
// law (D6): every evaluator fires ONLY on affirmative, quote-citable evidence
// from quoteVerified=true rows — absence of information NEVER fires, and
// exclusion matching uses strict token adjacency (maxGap 0), stricter than
// scoring's matching posture.

const EXCLUSION_GAP = 0;

/** First eligible requirement (canonical order) whose text/quote contains the
 *  phrase — the verdict cites its verified sourceQuote. */
function firstMatch(
  prepared: PreparedInput,
  phrase: string,
  categories?: readonly ScoringRequirement['category'][],
): ScoringRequirement | undefined {
  const phraseTokens = tokenizeForMatching(phrase);
  return prepared.eligible.find(
    (requirement) =>
      (categories === undefined || categories.includes(requirement.category)) &&
      phraseMatches(
        prepared.requirementTokens.get(requirement.id) ?? [],
        phraseTokens,
        EXCLUSION_GAP,
      ),
  );
}

function slugVerdicts(
  prepared: PreparedInput,
  filterKey: HardFilterKey,
  slugs: readonly string[] | undefined,
  categories?: readonly ScoringRequirement['category'][],
): ExclusionVerdict[] {
  if (!slugs) return [];
  const verdicts: ExclusionVerdict[] = [];
  for (const slug of slugs) {
    const hit = firstMatch(prepared, slug, categories);
    if (hit) {
      verdicts.push({ filterKey, matchedValue: slug, postingQuote: hit.sourceQuote });
    }
  }
  return verdicts;
}

/**
 * `base_salary_max_is_known_and_below`: "known" means at least one
 * comp-category requirement parses unambiguously AND every parsed range
 * agrees the max sits below the floor (conflicting parses = unknown = no
 * fire). The verdict cites the first parsing requirement's quote.
 */
function salaryFloorVerdict(prepared: PreparedInput, floor: number): ExclusionVerdict[] {
  const parsed: { requirement: ScoringRequirement; max: number }[] = [];
  for (const requirement of prepared.eligible) {
    if (requirement.category !== 'comp') continue;
    const range = parseCompRange(`${requirement.text} ${requirement.sourceQuote}`);
    if (range) parsed.push({ requirement, max: range.max });
  }
  if (parsed.length === 0) return [];
  if (!parsed.every((entry) => entry.max < floor)) return [];
  const cited = parsed[0]!;
  return [
    {
      filterKey: 'base_salary_max_is_known_and_below',
      matchedValue: String(cited.max),
      postingQuote: cited.requirement.sourceQuote,
    },
  ];
}

/**
 * Evaluates the closed exclude_when key set, in HARD_FILTER_KEYS order.
 *
 * `onsite_requirement` NEVER fires automatically in v1 (documented
 * narrowing): "outside metro" / "without relocation support" need location
 * knowledge and negation semantics no deterministic text rule can AFFIRM, and
 * D6 forbids firing on inference-from-absence. Location requirements surface
 * in the comp_location rationale for the human review the M1-10 UI exists
 * for.
 */
export function evaluateExclusions(prepared: PreparedInput): ExclusionVerdict[] {
  const filters = prepared.criteria.hardFilters;
  const verdicts: ExclusionVerdict[] = [];

  for (const key of HARD_FILTER_KEYS) {
    switch (key) {
      case 'base_salary_max_is_known_and_below':
        if (filters.base_salary_max_is_known_and_below !== undefined) {
          verdicts.push(
            ...salaryFloorVerdict(prepared, filters.base_salary_max_is_known_and_below),
          );
        }
        break;
      case 'compensation_type':
        if (filters.compensation_type === 'equity_only') {
          const hit = firstMatch(prepared, 'equity only');
          if (hit) {
            verdicts.push({
              filterKey: key,
              matchedValue: 'equity_only',
              postingQuote: hit.sourceQuote,
            });
          }
        }
        break;
      case 'employment_type':
        verdicts.push(...slugVerdicts(prepared, key, filters.employment_type));
        break;
      case 'seniority':
        verdicts.push(...slugVerdicts(prepared, key, filters.seniority, ['seniority']));
        break;
      case 'onsite_requirement':
        break;
      case 'primary_function':
        verdicts.push(...slugVerdicts(prepared, key, filters.primary_function));
        break;
      case 'industry':
        verdicts.push(...slugVerdicts(prepared, key, filters.industry));
        break;
    }
  }
  return verdicts;
}
