import {
  fitInputSchema,
  tokenizeForMatching,
  type EvidenceLink,
  type EvidenceStrength,
  type FitInput,
  type ProfileExperience,
  type ProfileProject,
  type ProfileSkill,
  type ScoringRequirement,
  type SearchCriteriaData,
  type UnscoredRequirement,
} from '@careerforge/core';

import { phraseMatches } from './matching.ts';

// Input preparation (M1-09): validation, canonicalization (A4 — the engine
// sorts EVERY input array itself, so identical input SETS give identical
// output regardless of caller ordering), the D3 eligibility split, token
// corpora, and per-requirement profile evidence. Dimension modules only ever
// see this prepared view.

/** Evidence weights used by every coverage computation (one definition). */
export const EVIDENCE_WEIGHTS: Record<EvidenceStrength, number> = {
  direct: 1,
  partial: 0.5,
  adjacent: 0.25,
};

export interface PreparedInput {
  /** quoteVerified === true rows only, sorted by (position, id). */
  eligible: ScoringRequirement[];
  /** false AND NULL rows with their distinct verification-state reasons (D3),
   *  in the same canonical order. */
  unscored: UnscoredRequirement[];
  skills: ProfileSkill[];
  experiences: ProfileExperience[];
  projects: ProfileProject[];
  criteria: SearchCriteriaData;
  referenceDate: string;
  inputFlagged: boolean;
  /** Per eligible requirement id: its profile evidence, canonical order. */
  evidence: Map<string, EvidenceLink[]>;
  /** Per eligible requirement id: tokens of text + sourceQuote. */
  requirementTokens: Map<string, string[]>;
}

/** UTF-16 code-unit comparison — locale-independent by construction
 *  (localeCompare would import the HOST locale into the output ordering). */
const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a: { id: string }, b: { id: string }) => compareStrings(a.id, b.id);
const sortSlugs = (slugs: readonly string[]): string[] => [...slugs].sort(compareStrings);

/** Canonicalize every array inside the criteria payload (order is never
 *  semantic there — the YAML lists are sets). */
function canonicalizeCriteria(criteria: SearchCriteriaData): SearchCriteriaData {
  const { hardFilters, positiveSignals, negativeSignals, forceLowestPriority, compBounds } =
    criteria;
  return {
    hardFilters: {
      ...hardFilters,
      ...(hardFilters.employment_type
        ? { employment_type: sortSlugs(hardFilters.employment_type) }
        : {}),
      ...(hardFilters.seniority ? { seniority: sortSlugs(hardFilters.seniority) } : {}),
      ...(hardFilters.primary_function
        ? { primary_function: sortSlugs(hardFilters.primary_function) }
        : {}),
      ...(hardFilters.industry ? { industry: sortSlugs(hardFilters.industry) } : {}),
    },
    positiveSignals: {
      role: sortSlugs(positiveSignals.role),
      technologies: sortSlugs(positiveSignals.technologies),
      problem_domains: sortSlugs(positiveSignals.problem_domains),
      work_arrangement: sortSlugs(positiveSignals.work_arrangement),
      scope: sortSlugs(positiveSignals.scope),
    },
    negativeSignals: sortSlugs(negativeSignals),
    forceLowestPriority: { industry: sortSlugs(forceLowestPriority.industry) },
    compBounds,
  };
}

function skillQuote(skill: ProfileSkill): string {
  return `${skill.name} (${skill.level}${skill.years !== null ? `, ${String(skill.years)} yrs` : ''})`;
}

function projectQuote(project: ProfileProject): string {
  const summary = project.summary ?? '';
  const rendered = summary === '' ? project.name : `${project.name}: ${summary}`;
  return rendered.length > 120 ? `${rendered.slice(0, 120)}...` : rendered;
}

function experienceQuote(experience: ProfileExperience): string {
  return `${experience.title} at ${experience.company}`;
}

/**
 * Profile evidence for one requirement:
 * - NAMED-SKILL links — the skill name phrase appears in the requirement
 *   text/quote; strength by level (expert|solid = direct, rusty|learning =
 *   partial), per the EVIDENCE_STRENGTHS contract.
 * - BRIDGE links (adjacent) — a technologies/problem_domains slug matches the
 *   requirement AND a project (name+summary) or experience (title); the
 *   criteria vocabulary is the bridge, which keeps adjacency precise instead
 *   of stopword-fuzzy. One adjacent link per profile item per requirement.
 */
function evidenceForRequirement(
  requirement: ScoringRequirement,
  tokens: readonly string[],
  prepared: Pick<PreparedInput, 'skills' | 'experiences' | 'projects' | 'criteria'>,
): EvidenceLink[] {
  const links: EvidenceLink[] = [];
  for (const skill of prepared.skills) {
    if (!phraseMatches(tokens, tokenizeForMatching(skill.name))) continue;
    const direct = skill.level === 'expert' || skill.level === 'solid';
    links.push({
      requirementId: requirement.id,
      profileSkillId: skill.id,
      profileProjectId: null,
      profileExperienceId: null,
      postingQuote: requirement.sourceQuote,
      profileQuote: skillQuote(skill),
      strength: direct ? 'direct' : 'partial',
    });
  }

  const bridgeSlugs = sortSlugs([
    ...new Set([
      ...prepared.criteria.positiveSignals.technologies,
      ...prepared.criteria.positiveSignals.problem_domains,
    ]),
  ]);
  const linkedProjects = new Set<string>();
  const linkedExperiences = new Set<string>();
  for (const slug of bridgeSlugs) {
    const slugTokens = tokenizeForMatching(slug);
    if (!phraseMatches(tokens, slugTokens)) continue;
    for (const project of prepared.projects) {
      if (linkedProjects.has(project.id)) continue;
      const corpus = tokenizeForMatching(`${project.name} ${project.summary ?? ''}`);
      if (!phraseMatches(corpus, slugTokens)) continue;
      linkedProjects.add(project.id);
      links.push({
        requirementId: requirement.id,
        profileSkillId: null,
        profileProjectId: project.id,
        profileExperienceId: null,
        postingQuote: requirement.sourceQuote,
        profileQuote: projectQuote(project),
        strength: 'adjacent',
      });
    }
    for (const experience of prepared.experiences) {
      if (linkedExperiences.has(experience.id)) continue;
      if (!phraseMatches(tokenizeForMatching(experience.title), slugTokens)) continue;
      linkedExperiences.add(experience.id);
      links.push({
        requirementId: requirement.id,
        profileSkillId: null,
        profileProjectId: null,
        profileExperienceId: experience.id,
        postingQuote: requirement.sourceQuote,
        profileQuote: experienceQuote(experience),
        strength: 'adjacent',
      });
    }
  }
  return links;
}

/** Best evidence weight for a requirement (0 = no evidence). */
export function coverageOf(links: readonly EvidenceLink[] | undefined): number {
  if (!links || links.length === 0) return 0;
  return Math.max(...links.map((link) => EVIDENCE_WEIGHTS[link.strength]));
}

export function prepareInput(rawInput: FitInput): PreparedInput {
  const input = fitInputSchema.parse(rawInput);

  const requirements = [...input.requirements].sort(
    (a, b) => a.position - b.position || compareStrings(a.id, b.id),
  );
  const eligible = requirements.filter((requirement) => requirement.quoteVerified === true);
  const unscored: UnscoredRequirement[] = requirements
    .filter((requirement) => requirement.quoteVerified !== true)
    .map((requirement) => ({
      requirementId: requirement.id,
      reason: requirement.quoteVerified === false ? 'failed_verification' : 'not_yet_verified',
    }));

  const skills = [...input.profile.skills].sort(
    (a, b) => compareStrings(a.name.toLowerCase(), b.name.toLowerCase()) || byId(a, b),
  );
  const experiences = [...input.profile.experiences].sort(
    (a, b) => compareStrings(a.startDate, b.startDate) || byId(a, b),
  );
  const projects = [...input.profile.projects].sort(
    (a, b) => compareStrings(a.name.toLowerCase(), b.name.toLowerCase()) || byId(a, b),
  );
  const criteria = canonicalizeCriteria(input.criteria);

  const requirementTokens = new Map<string, string[]>();
  for (const requirement of eligible) {
    requirementTokens.set(
      requirement.id,
      tokenizeForMatching(`${requirement.text} ${requirement.sourceQuote}`),
    );
  }

  const evidence = new Map<string, EvidenceLink[]>();
  for (const requirement of eligible) {
    evidence.set(
      requirement.id,
      evidenceForRequirement(requirement, requirementTokens.get(requirement.id) ?? [], {
        skills,
        experiences,
        projects,
        criteria,
      }),
    );
  }

  return {
    eligible,
    unscored,
    skills,
    experiences,
    projects,
    criteria,
    referenceDate: input.referenceDate,
    inputFlagged: input.runStatus === 'flagged',
    evidence,
    requirementTokens,
  };
}
