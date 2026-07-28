import { type RequirementCategory } from './enums.ts';

// M9-04 (V2-PLAN 3.5): the deterministic demo-blueprint scaffolder. Pure,
// clock-free, browser-safe (no Node builtins) - counts and enum tokens in, four
// instructive section strings out. NO LLM contributes here; the sections are
// template assembly that INSTRUCTS the user (H-01: scaffolding instructs, never
// asserts the user's experience or the demo's outcome), the case-study-markdown
// renderer's lineage.
//
// SECTIONS CARRY NO POSTING-DERIVED TEXT (D3, the T5 extension): the requirement
// text is deliberately NOT an input to this function, so leaking posting wording
// into a section is STRUCTURALLY impossible - there is nothing to leak from. The
// wire juxtaposes the requirement text as its own clearly-untrusted display field
// (requirementText), never built into these sections. The service reads the exact
// requirement alongside; this brief only ever sees COUNTS the aggregator derived
// from the user's own saved postings.
//
// NUMERIC LAW (D3): every number that appears in a rendered section is one of the
// input counts, interpolated as-is. No template CONSTANT contains a digit, so the
// only digit-runs in the output are the counts themselves (test-pinned: the
// digit-runs across all four sections equal exactly the interpolated counts).
// Milestone/ADR tokens (which carry digits) are therefore deliberately absent from
// the copy - the evidence flow is described in words, not named by token.
//
// ASCII / URL-FREE (D3): all template strings are printable ASCII, em-dash-free,
// and contain no URL, `www.`, `@`, or bare domain by construction (test-pinned).

/** The scaffolder's only inputs: COUNTS + enum tokens from the anchor's market-
 *  signal group. The requirement text is intentionally excluded (D3). */
export interface DemoBlueprintScaffoldInput {
  postingCount: number;
  instanceCount: number;
  mustHavePostingCount: number;
  niceToHavePostingCount: number;
  categories: RequirementCategory[];
}

/** The four scaffolded section texts (the persisted + wire artifact). */
export interface DemoBlueprintSections {
  problem: string;
  constraints: string;
  deliverables: string;
  evidenceRequired: string;
}

/** Length bound on the server-default blueprint title (the exercises title-law
 *  value, EXERCISE_TITLE_MAX_CHARS). The service derives the default title as
 *  normalizeWhitespace(requirementText) truncated to this; title is display DATA
 *  like requirementText itself. */
export const DEMO_BLUEPRINT_TITLE_MAX_CHARS = 200;

/** The claim ceiling - byte-pinned by a core test AND asserted verbatim on the
 *  wire by the route test (the M9-02 two-layer honesty discipline). Template
 *  scaffolding over deterministic counts from the user's own saved postings; it
 *  instructs, never asserts; the requirement text rides separately as reference;
 *  the snapshot is as-of-generate and deliberately outlives the postings behind
 *  it (refresh or delete are the recourses); nothing here is advice or a claim
 *  about the user. Digit-free by the same numeric law as the sections. */
export const DEMO_BLUEPRINT_HONESTY =
  'Template scaffolding over deterministic counts from your own saved postings. It instructs; it never asserts that you have experience or that a demo will close a gap. The exact requirement text is shown separately as reference, not built into these sections. This snapshot is as of when it was generated and deliberately outlives the postings behind it; refresh it or delete it to move on. Nothing here is advice or a claim about you.';

/** `spanning the <a>, <b> area(s)` when categories are present, else ''. The
 *  category tokens are enum inputs (interpolations), not template constants. */
function categoriesClause(categories: RequirementCategory[]): string {
  if (categories.length === 0) return '';
  return ` spanning the ${categories.join(', ')} area(s)`;
}

/**
 * Scaffold the four demo-blueprint sections from a market-signal group's counts.
 * Deterministic: identical input yields identical bytes (no clock, no
 * randomness). The sections instruct the user to BUILD and to record real
 * evidence; they never assert an outcome and never carry posting-derived text.
 */
export function scaffoldDemoBlueprint(input: DemoBlueprintScaffoldInput): DemoBlueprintSections {
  const { postingCount, instanceCount, mustHavePostingCount, niceToHavePostingCount, categories } =
    input;

  const problem =
    'Define, in your own words, the capability this build should demonstrate. This skill recurs across your own saved postings: it appears in ' +
    `${postingCount} of them (${mustHavePostingCount} as a must-have, ` +
    `${niceToHavePostingCount} as a preferred or nice-to-have), with ` +
    `${instanceCount} total requirement mentions${categoriesClause(categories)}. ` +
    'Do not copy any posting wording into this brief; the exact requirement text is shown to you ' +
    'separately, as reference only. State the problem as a concrete, buildable goal you can point ' +
    'at later.';

  const constraints =
    'Work only with evidence you can actually produce. Do not fabricate data, metrics, results, ' +
    'or experience; if you have not measured something, do not claim it. Keep the scope tight to ' +
    'what the requirement genuinely asks for, which you can read in the reference text shown ' +
    'alongside this brief, and resist widening it into unrelated work. Everything you produce here ' +
    'stays a draft you own until you review it; nothing about this brief is a claim that you have ' +
    'already done the work.';

  const deliverables =
    'Aim for two things you can show: a small, runnable repository or demo that exercises the ' +
    'skill directly, and a short written walkthrough of what you built and the decisions behind ' +
    'it. Keep it reproducible, so someone else could clone it and run it from your notes alone. ' +
    'This maps cleanly onto a project-style and a writeup-style exercise; frame the work as those. ' +
    'Do not point at or depend on any external product, site, or link inside this brief; describe ' +
    'what you build in plain terms.';

  const evidenceRequired =
    'When the build holds together, record it as real mastery evidence: attach the actual artifact ' +
    'links and writeups you produced, mark the exercise complete, and let that completed, evidenced ' +
    'work flow into a case-study draft. The evidence has to be genuine and verifiable; recording a ' +
    'link you cannot back up defeats the whole point. Nothing here is finished until you, not this ' +
    'tool, attest that it is.';

  return { problem, constraints, deliverables, evidenceRequired };
}
