import { type CanonicalResumeDoc } from '@careerforge/core';

import { SECTION_HEADINGS } from './constants.ts';

// The SHARED layout projection (D3). All five formats render from this one
// structure, so the document has identical section order + grouping in every
// format. Building it once here is the single source of layout truth; the parse
// audit reconstructs the SAME structural anchors from it (never from the raw
// doc), so the audit and the renderer can never disagree on what was rendered.

/** A run of lines under an optional entity subheading. */
export interface ResumeLayoutGroup {
  /** entityLabel for an experience/project group; null for ungrouped runs. */
  subheading: string | null;
  /** Display lines (claim texts, the skills line, education lines, link lines). */
  lines: string[];
}

export interface ResumeLayoutSection {
  heading: string;
  groups: ResumeLayoutGroup[];
}

export interface ResumeLayout {
  name: string;
  headline: string | null;
  /** email / phone / location joined by ` | ` (ASCII), or null when all absent. */
  contactLine: string | null;
  links: { label: string; url: string }[];
  /** ONLY non-empty sections, in the fixed render order. */
  sections: ResumeLayoutSection[];
}

/** Collapse whitespace runs (incl. embedded newlines the composed prose may
 *  carry) to single spaces and trim - the render normalization the parse-audit
 *  mirrors, so a claim's text matches verbatim after PDF/DOCX text reflow. */
export function normalizeInline(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Claims of one section, grouped by entityLabel in first-seen position order. */
function groupClaims(
  doc: CanonicalResumeDoc,
  section: 'summary' | 'experience' | 'project',
): ResumeLayoutGroup[] {
  const claims = doc.claims
    .filter((claim) => claim.section === section)
    .slice()
    .sort((a, b) => a.position - b.position);
  if (claims.length === 0) return [];

  // Summary is never grouped (entityLabel is null); experience/projects group by
  // their durable entityLabel, preserving first-seen order.
  if (section === 'summary') {
    return [{ subheading: null, lines: claims.map((claim) => normalizeInline(claim.text)) }];
  }

  const groups: ResumeLayoutGroup[] = [];
  const byLabel = new Map<string, ResumeLayoutGroup>();
  for (const claim of claims) {
    const key = claim.entityLabel ?? '';
    let group = byLabel.get(key);
    if (!group) {
      group = { subheading: claim.entityLabel, lines: [] };
      byLabel.set(key, group);
      groups.push(group);
    }
    group.lines.push(normalizeInline(claim.text));
  }
  return groups;
}

function formatEducationLine(edu: CanonicalResumeDoc['education'][number]): string {
  const head = edu.credential ? `${edu.credential}, ${edu.institution}` : edu.institution;
  let years = '';
  if (edu.startYear !== null && edu.endYear !== null) years = `${edu.startYear}-${edu.endYear}`;
  else if (edu.startYear !== null) years = `${edu.startYear}`;
  else if (edu.endYear !== null) years = `${edu.endYear}`;
  return normalizeInline(years ? `${head} (${years})` : head);
}

export function buildLayout(doc: CanonicalResumeDoc): ResumeLayout {
  const contactLine =
    [doc.contact.email, doc.contact.phone, doc.contact.location]
      .filter((value): value is string => value !== null && value.trim() !== '')
      .map((value) => normalizeInline(value))
      .join(' | ') || null;

  const sections: ResumeLayoutSection[] = [];

  const summary = groupClaims(doc, 'summary');
  if (summary.length > 0) sections.push({ heading: SECTION_HEADINGS.summary, groups: summary });

  const experience = groupClaims(doc, 'experience');
  if (experience.length > 0)
    sections.push({ heading: SECTION_HEADINGS.experience, groups: experience });

  const projects = groupClaims(doc, 'project');
  if (projects.length > 0) sections.push({ heading: SECTION_HEADINGS.project, groups: projects });

  if (doc.skills.length > 0) {
    const line = doc.skills
      .map((skill) => `${normalizeInline(skill.name)} (${skill.level})`)
      .join(', ');
    sections.push({
      heading: SECTION_HEADINGS.skills,
      groups: [{ subheading: null, lines: [line] }],
    });
  }

  if (doc.education.length > 0) {
    sections.push({
      heading: SECTION_HEADINGS.education,
      groups: [{ subheading: null, lines: doc.education.map(formatEducationLine) }],
    });
  }

  return {
    name: normalizeInline(doc.contact.fullName),
    headline: doc.contact.headline ? normalizeInline(doc.contact.headline) : null,
    contactLine,
    links: doc.contact.links.map((link) => ({
      label: normalizeInline(link.label),
      url: normalizeInline(link.url),
    })),
    sections,
  };
}
