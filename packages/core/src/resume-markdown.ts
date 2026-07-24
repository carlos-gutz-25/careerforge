import type {
  EvidenceStrength,
  GapClassification,
  RequirementCategory,
  RequirementKind,
  ResumeEmphasisLevel,
  ResumeEntityType,
} from './enums.ts';

// The deterministic resume-variant renderer (M2-10 §4): pure snapshot-structs-
// in / string-out, rendered ONCE at draft time and stored as
// resume_variants.rendered_markdown — what review approves is byte-for-byte
// what export serves. The model contributes NO prose here: body strings are the
// user's own verified profile content (same trust class as their resume.md,
// rendered as-is), and every posting-derived or LLM-generated string lives ONLY
// inside a fenced code block (markdown-inert — ADR-0006 layer 5 answered for the
// export). This is a tailoring/emphasis GUIDE over verified facts, not a
// submittable bulleted resume.

export interface ResumeRenderEvidence {
  strength: EvidenceStrength;
  postingQuote: string;
  profileQuote: string;
}

export interface ResumeRenderCitation {
  requirementText: string;
  requirementKind: RequirementKind;
  requirementCategory: RequirementCategory;
  /** The gap's EFFECTIVE classification at draft time. */
  classification: GapClassification;
  evidence: readonly ResumeRenderEvidence[];
}

export interface ResumeRenderEntry {
  section: ResumeEntityType;
  /** The user's own verified content — rendered as body text (as-is). For
   *  projects the service folds the provenance label into this (honest-labeling,
   *  ADR-0010), so provenance is always present in the output. */
  label: string;
  detail: string | null;
  /** NULL = standard weight (no marker, no notes entry). */
  emphasis: ResumeEmphasisLevel | null;
  /** Present iff emphasis (the entry-level CHECK); LLM-generated ⇒ fenced. */
  reason: string | null;
  /** Non-empty iff emphasis; the citing requirements + evidence ⇒ fenced. */
  citations: readonly ResumeRenderCitation[];
  /** M2-12 (experience entries only): the SELECTED bullets in render order —
   *  the user's own verified content, rendered as-is (same trust class as
   *  label/detail, NOT fenced). Absent/empty ⇒ the experience renders with no
   *  sub-list; the experience line itself always renders (a job is never
   *  hidden). Newlines are collapsed at render so a bullet can't break the
   *  sub-list structure (a render-integrity guard, not escaping). */
  bullets?: readonly string[];
}

export interface ResumeRenderInput {
  fitReportId: string;
  /** YYYY-MM-DD, supplied by the caller — this function has no clock. */
  generatedDate: string;
  /** Service-ordered: skills (spec order), experiences (DB chronological —
   *  never reordered/omitted), projects (spec order). The renderer preserves
   *  the given order within each section and has NO sort of its own. */
  entries: readonly ResumeRenderEntry[];
}

/** Longest run of backticks anywhere in the content (0 if none). */
function longestBacktickRun(content: string): number {
  let longest = 0;
  const matches = content.match(/`+/g);
  if (matches) {
    for (const run of matches) longest = Math.max(longest, run.length);
  }
  return longest;
}

/**
 * A fence guaranteed to enclose `content` without a breakout: at least three
 * backticks, and always one longer than the longest backtick run inside
 * (CommonMark's fence rule). `\r` is stripped so a CRLF payload can't smuggle a
 * bare `\r`. Exported for its own breakout unit tests.
 */
export function fenceFor(content: string): string {
  const clean = content.replace(/\r/g, '');
  return '`'.repeat(Math.max(3, longestBacktickRun(clean) + 1));
}

/** Wrap untrusted content in a safe fenced block (no trailing newline — the
 *  line join adds separation). */
function fencedBlock(content: string): string {
  const clean = content.replace(/\r/g, '');
  const fence = fenceFor(clean);
  return `${fence}\n${clean}\n${fence}`;
}

const PROVENANCE_NOTE =
  'This variant REORDERS and EMPHASIZES existing verified profile content only. It invents nothing, and it is a tailoring/emphasis guide, not a submittable resume. Draft until reviewed; export is manual and never sent anywhere.';

function renderEntryLine(entry: ResumeRenderEntry, marker: string): string {
  const emphasized = entry.emphasis !== null;
  const name = emphasized ? `**${entry.label}**` : entry.label;
  const detail = entry.detail === null ? '' : ` · ${entry.detail}`;
  return `- ${name}${detail}${marker}`;
}

/**
 * Renders the stored markdown snapshot. Deterministic: identical input →
 * identical bytes. `[n]` markers number the emphasized entries in the given
 * order; the Tailoring notes appendix explains each with the model's rationale
 * and citing requirements, all fenced.
 */
export function renderResumeVariantMarkdown(input: ResumeRenderInput): string {
  // Number emphasized entries in render order; the same number labels the
  // entry in the body and its notes block.
  const markerByEntry = new Map<ResumeRenderEntry, string>();
  let counter = 0;
  for (const entry of input.entries) {
    if (entry.emphasis !== null) {
      counter += 1;
      markerByEntry.set(entry, ` [${String(counter)}]`);
    }
  }
  const markerFor = (entry: ResumeRenderEntry) => markerByEntry.get(entry) ?? '';

  const bySection = (section: ResumeEntityType) =>
    input.entries.filter((entry) => entry.section === section);

  const lines: string[] = [];
  lines.push('# Tailored resume variant (draft)');
  lines.push('');
  lines.push(`Generated ${input.generatedDate} from fit report ${input.fitReportId}.`);
  lines.push('');
  lines.push(PROVENANCE_NOTE);

  // Highlights: the lead-emphasis entries only (skip the section if none).
  const leads = input.entries.filter((entry) => entry.emphasis === 'lead');
  if (leads.length > 0) {
    lines.push('');
    lines.push('## Highlights');
    lines.push('');
    for (const entry of leads) lines.push(renderEntryLine(entry, markerFor(entry)));
  }

  const sections: { title: string; section: ResumeEntityType }[] = [
    { title: 'Skills', section: 'skill' },
    { title: 'Experience', section: 'experience' },
    { title: 'Projects', section: 'project' },
  ];
  for (const { title, section } of sections) {
    const entries = bySection(section);
    if (entries.length === 0) continue;
    lines.push('');
    lines.push(`## ${title}`);
    lines.push('');
    for (const entry of entries) {
      lines.push(renderEntryLine(entry, markerFor(entry)));
      // M2-12: selected experience bullets as an indented sub-list, in the
      // given order. Newlines collapsed so a bullet can't break the structure.
      for (const bullet of entry.bullets ?? []) {
        lines.push(`  - ${bullet.replace(/[\r\n]+/g, ' ')}`);
      }
    }
  }

  // Tailoring notes: generated metadata, every untrusted string fenced.
  const emphasized = input.entries.filter((entry) => entry.emphasis !== null);
  lines.push('');
  lines.push('## Tailoring notes (generated metadata, not resume content)');
  if (emphasized.length === 0) {
    lines.push('');
    lines.push('No emphasis was applied; this variant is a pure reordering.');
  }
  for (const entry of emphasized) {
    lines.push('');
    lines.push(`**${markerFor(entry).trim()} ${entry.label}** (${entry.emphasis ?? ''} emphasis)`);
    lines.push('');
    lines.push(fencedBlock(`generated rationale: ${entry.reason ?? ''}`));
    for (const citation of entry.citations) {
      const evidenceLines = citation.evidence.map(
        (item) =>
          `evidence (${item.strength}):\n  posting: ${item.postingQuote}\n  profile: ${item.profileQuote}`,
      );
      const body = [
        `requirement (${citation.requirementKind} · ${citation.requirementCategory} · ${citation.classification}): ${citation.requirementText}`,
        ...evidenceLines,
      ].join('\n');
      lines.push(fencedBlock(body));
    }
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}
