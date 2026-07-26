import type { EvidenceKind, ExerciseCaseStudyProvenance, ExerciseKind } from './enums.ts';

// The deterministic case-study draft renderer (M4-01 §7.3): pure
// snapshot-structs-in / string-out, clock-free (the caller supplies
// `completedOn`, which doubles as the frontmatter date). NO LLM contributes
// here — the draft ships TODO scaffolding that INSTRUCTS the author, never
// generated claims (H-01: pre-fill instructs, never asserts outcomes; the prose
// an LLM would write is exactly the prose that must be the author's own voice).
//
// The output is born inside the portfolio honesty gate (ADR-0010): it emits
// EXACTLY the validator's grammar — a flat-scalar frontmatter with a valid
// provenance token, no body h1, no prose `provenance:` line, exactly the seven
// canonical `##` sections in order, every section non-empty, and a Results
// section with no unsourced numbers. The born-valid test (apps/api) proves this
// by spawning the real validator CLI on rendered output.
//
// Privacy (T5): posting-derived text (gap requirement text / source quotes)
// NEVER enters the rendered markdown — linked gaps appear as a COUNT only, with
// an instruction to describe gaps in the author's own words. Defense-in-depth,
// because privacy-check probes profile tokens, NOT posting text.

/** One recorded mastery-evidence row, snapshotted into the Testing section. */
export interface CaseStudyDraftEvidence {
  kind: EvidenceKind;
  artifactUrl: string | null;
  /** YYYY-MM-DD (drizzle date string-mode). */
  recordedOn: string;
}

export interface CaseStudyDraftInput {
  title: string;
  provenance: ExerciseCaseStudyProvenance;
  exerciseTitle: string;
  exerciseKind: ExerciseKind;
  /** YYYY-MM-DD; doubles as the frontmatter `date` — this function has NO clock. */
  completedOn: string;
  evidence: readonly CaseStudyDraftEvidence[];
  /** COUNT only — requirement text is BANNED from the rendered draft (T5). */
  linkedGapCount: number;
}

/**
 * Collapse every newline (and CR) to a single space. The M2-12 bullet-collapse
 * precedent: every user string renders MID-LINE after a fixed ASCII prefix, so
 * all line-start-anchored validator rules (`^#{1,6}\s`, `^\s*\`\`\``,
 * `^\s*(\*\*)?provenance:`, `---`) are structurally unreachable from user
 * content. This is the single load-bearing render-integrity guard — no fenced
 * blocks are needed, which keeps the draft human-editable.
 */
export function inline(value: string): string {
  return value.replace(/[\r\n]+/g, ' ');
}

/**
 * A frontmatter scalar: `inline()` then single-quote the value inside emitted
 * double quotes. Guarantees an R1 flat scalar AND valid @nuxt/content YAML (the
 * M2-07 `": "` parse incident); interior colons are safe because the validator's
 * R1 scanner splits on the first colon only.
 */
export function frontmatterScalar(value: string): string {
  return inline(value).replace(/"/g, "'");
}

/**
 * Render the case-study draft markdown. Deterministic: identical input ->
 * identical bytes (the refresh test relies on this). All template strings are
 * printable ASCII (source-byte law) — structurally em-dash-free.
 */
export function renderCaseStudyDraftMarkdown(input: CaseStudyDraftInput): string {
  const lines: string[] = [];

  // Frontmatter (R1): four flat `key: value` scalar lines.
  lines.push('---');
  lines.push(`title: "${frontmatterScalar(input.title)}"`);
  lines.push(
    'description: "Case-study draft generated from a completed exercise. Replace before publishing."',
  );
  lines.push(`date: ${input.completedOn}`);
  lines.push(`provenance: ${input.provenance}`);
  lines.push('---');
  lines.push('');

  // Author banner (no `#`-leading line — R4 has no HTML-comment awareness, so
  // the banner must avoid heading-leading lines itself).
  lines.push('<!--');
  lines.push('  LOCAL DRAFT, generated deterministically from platform exercise data (no LLM).');
  lines.push('  Publishing is a manual step: author every section in your own voice, replace');
  lines.push('  each TODO, delete this comment block, then run validate-case-studies plus the');
  lines.push('  privacy gates before committing this file to the portfolio.');
  lines.push('-->');
  lines.push('');

  // Problem
  lines.push('## Problem');
  lines.push('');
  lines.push('TODO: Describe, in your own words, the problem this exercise set out to solve.');
  lines.push(
    `Source exercise: "${inline(input.exerciseTitle)}" (kind: ${input.exerciseKind}), completed on ${input.completedOn}.`,
  );
  lines.push(
    `This exercise addressed ${String(input.linkedGapCount)} linked learning gap(s); describe the gap in your`,
  );
  lines.push('own words and never quote job-posting text here.');
  lines.push('');

  // Constraints
  lines.push('## Constraints');
  lines.push('');
  lines.push(
    'TODO: The real constraints (time, scope, tooling, environment) that shaped the work.',
  );
  lines.push('');

  // Architecture
  lines.push('## Architecture');
  lines.push('');
  lines.push('TODO: The shape of the solution and the key design decisions.');
  lines.push('');

  // Tradeoffs
  lines.push('## Tradeoffs');
  lines.push('');
  lines.push('TODO: What was traded away, and why that was the right call.');
  lines.push('');

  // Testing — the evidence rows land here (digit-heavy dates/URLs are OUTSIDE
  // R8's Results-only reach). The TODO line renders unconditionally so the
  // section is non-empty (R7) even if the evidence list were empty (the
  // completion gate makes empty impossible, but render defensively).
  lines.push('## Testing');
  lines.push('');
  lines.push('TODO: How the work was verified, in your own words. Recorded mastery evidence:');
  lines.push('');
  for (const item of input.evidence) {
    const artifact =
      item.artifactUrl === null ? 'no artifact URL recorded' : inline(item.artifactUrl);
    lines.push(`- ${item.kind} (${item.recordedOn}): ${artifact}`);
  }
  lines.push('');

  // Results — deliberately digit-free prose (the words "square brackets", never
  // a literal `[...]` example: a literal citation would be resolver-verified and
  // couple the draft to tree state). No `[` spans, no numbers ⇒ R8 has nothing
  // to flag, and the CI shallow-checkout SHA guard never fires.
  lines.push('## Results');
  lines.push('');
  lines.push('TODO: State the measured outcomes here. The portfolio honesty gate requires every');
  lines.push('number in this section to carry a citation in square brackets naming a repo path,');
  lines.push('commit hash, milestone token, or risk id, and every citation must resolve. Keep');
  lines.push('this section free of unsourced numbers until you can cite them.');
  lines.push('');

  // What I'd Change (ASCII apostrophe — the R6 pattern accepts both `'` and the
  // curly variant).
  lines.push("## What I'd Change");
  lines.push('');
  lines.push('TODO: An honest retrospective: what you would do differently, and what you learned.');

  // Trailing single newline (the resume-markdown idiom).
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
