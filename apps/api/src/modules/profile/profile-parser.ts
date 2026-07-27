// Pure markdown → structured-profile parsing (no I/O, no SQL). The format
// contract is docs/profile.example/: resume.md's "## Professional Experience"
// section, the skills.md table, and projects.md entries with explicit
// **Provenance:**. Every deviation becomes a ParseIssue with file + line;
// nothing is silently skipped, and nothing is ever invented (values come
// verbatim from the markdown or import as NULL).
import {
  PROJECT_PROVENANCES,
  SKILL_LEVELS,
  type ProjectProvenance,
  type SkillLevel,
} from '@careerforge/core';

import { ProfileParseError, type ParseIssue } from './parse-errors.ts';

export interface SourceFile {
  /** Name relative to the profile directory, used in issue messages. */
  name: string;
  content: string;
}

export interface ParsedSkill {
  name: string;
  category: string | null;
  level: SkillLevel;
  years: number | null;
  /** ISO date (first of the source's YYYY-MM month) or null. */
  lastUsed: string | null;
}

export interface ParsedExperience {
  company: string;
  title: string;
  /** ISO date. Month precision maps to the 1st; year precision to Jan 1. */
  startDate: string;
  /** ISO date (month → last day; year → Dec 31) or null for "Present". */
  endDate: string | null;
  /** The experience's verbatim bullets in source order (M2-12) — the user's
   *  own content, inner markdown kept as-is; [] when the entry has none. */
  bullets: string[];
}

export interface ParsedProject {
  name: string;
  /** Verbatim **Company:** value; null when absent (personal provenance). */
  company: string | null;
  provenance: ProjectProvenance;
  summary: string | null;
}

/** A contact-block markdown link that is neither tel: nor mailto: (LinkedIn
 *  today). Label + href, verbatim, in source order (M6-01). */
export interface ParsedContactLink {
  label: string;
  url: string;
}

/** The resume header facts from the contact block (M6-01). `fullName` is the
 *  H1 and always present after a clean parse (missing H1 is a hard error);
 *  everything else is optional. */
export interface ParsedContact {
  fullName: string;
  headline: string | null;
  phone: string | null;
  email: string | null;
  location: string | null;
  links: ParsedContactLink[];
}

/** One "## Professional Summary" paragraph, in source order (M6-01). */
export interface ParsedSummary {
  text: string;
  position: number;
}

/** One "## Education" entry (M6-01). credential + years nullable - a bare
 *  institution is a valid sparse entry. */
export interface ParsedEducation {
  institution: string;
  credential: string | null;
  startYear: number | null;
  endYear: number | null;
  position: number;
}

export interface ParsedProfile {
  /** Always present after a clean parse - a missing H1 is a hard parse error. */
  contact: ParsedContact;
  skills: ParsedSkill[];
  experiences: ParsedExperience[];
  projects: ParsedProject[];
  summaries: ParsedSummary[];
  education: ParsedEducation[];
}

/**
 * Parses the three profile sources together so cross-file checks (a
 * professional project must name a company from resume.md) run in the same
 * pass, and throws a single ProfileParseError carrying every issue found.
 */
export function parseProfile(sources: {
  resume: SourceFile;
  skills: SourceFile;
  projects: SourceFile;
}): ParsedProfile {
  const issues: ParseIssue[] = [];
  // Contact / summaries / education are independent of the experiences parse,
  // so they run first and their issues do NOT gate the projects cross-check
  // (resumeParsedClean measures the experiences-parse delta specifically).
  const contact = parseResumeContact(sources.resume, issues);
  const summaries = parseResumeSummary(sources.resume);
  const education = parseResumeEducation(sources.resume, issues);
  const experienceIssuesBefore = issues.length;
  const experiences = parseResumeExperiences(sources.resume, issues);
  const resumeParsedClean = issues.length === experienceIssuesBefore;
  const skills = parseSkillsTable(sources.skills, issues);
  const projects = parseProjects(sources.projects, issues, {
    // Suppress link errors when resume.md itself failed — they'd be noise on
    // top of the real problem.
    experiences: resumeParsedClean ? experiences : null,
  });
  if (issues.length > 0) throw new ProfileParseError(issues);
  if (contact === null) {
    // Unreachable: a null contact always pushes resume-missing-name, which the
    // guard above would have thrown on. Kept so the return type is non-null.
    throw new ProfileParseError([
      {
        file: sources.resume.name,
        line: 1,
        field: 'name',
        rule: 'resume-missing-name',
        message: 'resume.md is missing its "# Name" H1 line',
      },
    ]);
  }
  return { contact, skills, experiences, projects, summaries, education };
}

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "March 2020" → 2020-03-01 · "2016" → 2016-01-01 · null = unparseable. */
function parsePeriodStart(raw: string): string | null {
  const monthYear = /^([A-Za-z]+)\s+(\d{4})$/.exec(raw);
  if (monthYear?.[1] !== undefined && monthYear[2] !== undefined) {
    const month = MONTHS[monthYear[1].toLowerCase()];
    return month === undefined ? null : `${monthYear[2]}-${pad2(month)}-01`;
  }
  return /^\d{4}$/.test(raw) ? `${raw}-01-01` : null;
}

/** "March 2020" → 2020-03-31 · "2020" → 2020-12-31 · "Present" → null end. */
function parsePeriodEnd(raw: string): { endDate: string | null } | null {
  if (/^present$/i.test(raw)) return { endDate: null };
  const monthYear = /^([A-Za-z]+)\s+(\d{4})$/.exec(raw);
  if (monthYear?.[1] !== undefined && monthYear[2] !== undefined) {
    const month = MONTHS[monthYear[1].toLowerCase()];
    if (month === undefined) return null;
    const year = Number(monthYear[2]);
    // Day 0 of the next month = last day of this one.
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return { endDate: `${monthYear[2]}-${pad2(month)}-${pad2(lastDay)}` };
  }
  return /^\d{4}$/.test(raw) ? { endDate: `${raw}-12-31` } : null;
}

const PERIOD_HINT =
  'expected "*<start> - <end>*" where start/end are "March 2020", "2016", or "Present" (end only)';

function parseResumeExperiences(source: SourceFile, issues: ParseIssue[]): ParsedExperience[] {
  const lines = source.content.split('\n');
  const experiences: ParsedExperience[] = [];
  const seenKeys = new Map<string, number>();

  const sectionStart = lines.findIndex((line) => /^##\s+Professional Experience\s*$/.test(line));
  if (sectionStart === -1) {
    issues.push({
      file: source.name,
      line: 1,
      field: 'professional-experience',
      rule: 'missing-section',
      message: 'missing "## Professional Experience" section',
    });
    return experiences;
  }

  for (let i = sectionStart + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^##\s/.test(line)) break; // next top-level section
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (!heading?.[1]) continue;

    const title = heading[1];
    const headingLine = i + 1;

    // Entry body: everything up to the next ###/## heading.
    let company: string | undefined;
    let period: { raw: string; line: number } | undefined;
    // M2-12 bullet capture (flat, top-level hyphen only) + the silent-omission
    // guard: a LOOSE detector counts every bullet-shaped line in the SAME body
    // range; if any is not captured (an indented sub-bullet, a `*`/`+` marker),
    // the first one flags `uncaptured-bullet` — unsupported structure is never
    // dropped without a trace.
    const bullets: string[] = [];
    let detectedBulletCount = 0;
    let firstUncapturedBulletLine: number | undefined;
    for (let j = i + 1; j < lines.length && !/^##{1,2}\s/.test(lines[j] ?? ''); j++) {
      const rawLine = lines[j] ?? '';
      const body = rawLine.trim();
      // "**Acme Analytics Co.** — Springfield" (location optional, unparsed).
      const companyMatch = /^\*\*(.+?)\*\*(?:\s*[—–-]\s*.*)?$/.exec(body);
      if (companyMatch?.[1] && company === undefined) company = companyMatch[1].trim();
      // "*March 2020 - Present*" (single asterisks).
      const periodMatch = /^\*([^*].*?)\*$/.exec(body);
      if (periodMatch?.[1] && period === undefined) period = { raw: periodMatch[1], line: j + 1 };
      // Capture: a top-level hyphen bullet at column 0 (the canonical resume.md
      // form). `**Bold**`/`*period*` lines never match — they start with `*`,
      // not "- " — so bullet and company/period capture never cross-contaminate.
      const bulletMatch = /^-[ \t]+(\S.*?)\s*$/.exec(rawLine);
      if (bulletMatch?.[1] !== undefined) bullets.push(bulletMatch[1]);
      // Detector: any bullet-shaped line (indented or `*`/`+`) in this body.
      if (/^\s*[-*+][ \t]+\S/.test(rawLine)) {
        detectedBulletCount++;
        if (bulletMatch?.[1] === undefined && firstUncapturedBulletLine === undefined) {
          firstUncapturedBulletLine = j + 1;
        }
      }
    }

    if (company === undefined) {
      issues.push({
        file: source.name,
        line: headingLine,
        field: 'company',
        rule: 'missing-field',
        message: `experience "${title}" is missing its "**Company**" line`,
      });
    }
    if (period === undefined) {
      issues.push({
        file: source.name,
        line: headingLine,
        field: 'period',
        rule: 'missing-field',
        message: `experience "${title}" is missing its "*<period>*" line — ${PERIOD_HINT}`,
      });
    }
    if (company === undefined || period === undefined) continue;

    const range = /^(.+?)\s*[–—-]\s*(.+)$/.exec(period.raw.trim());
    const startDate = range?.[1] === undefined ? null : parsePeriodStart(range[1].trim());
    const end = range?.[2] === undefined ? null : parsePeriodEnd(range[2].trim());
    if (startDate === null || end === null) {
      issues.push({
        file: source.name,
        line: period.line,
        field: 'period',
        rule: 'invalid-value',
        message: `experience "${title}" has an unparseable period "${period.raw}" — ${PERIOD_HINT}`,
      });
      continue;
    }

    const key = `${company.toLowerCase()}|${title.toLowerCase()}|${startDate}`;
    const firstSeen = seenKeys.get(key);
    if (firstSeen !== undefined) {
      issues.push({
        file: source.name,
        line: headingLine,
        field: 'experience',
        rule: 'duplicate-entry',
        message: `duplicate experience "${title}" at "${company}" starting ${startDate} (first at line ${firstSeen})`,
      });
      continue;
    }
    seenKeys.set(key, headingLine);

    // Silent-omission guard (M2-12): a cleanly-parsed experience whose body has
    // more bullet-shaped lines than were captured hides content — flag the
    // first uncaptured one rather than dropping it. Zero bullets is valid; a
    // captured-count that matches the detected count (incl. both zero) passes.
    if (detectedBulletCount > bullets.length && firstUncapturedBulletLine !== undefined) {
      issues.push({
        file: source.name,
        line: firstUncapturedBulletLine,
        field: 'bullets',
        rule: 'uncaptured-bullet',
        message: `experience "${title}" has a bullet-shaped line that is not a top-level "- " bullet (indent it out or use "- ") — bullets are never silently dropped`,
      });
      continue;
    }

    experiences.push({ company, title, startDate, endDate: end.endDate, bullets });
  }

  return experiences;
}

// A single markdown link occupying the whole (trimmed) line: "[label](url)".
const CONTACT_LINK = /^\[([^\]]*)\]\(([^)]+)\)$/;
// A bold-only line: "**Senior Software Engineer**".
const BOLD_LINE = /^\*\*(.+?)\*\*$/;

/**
 * The contact block = the region between the H1 (`# Name`) and the first "## "
 * section. Classifies each non-empty, non-blockquote line into the header
 * facts; the first bold line is the headline, the first plain line is the
 * location, tel:/mailto: links become phone/email, other links accumulate.
 * A line that matches nothing is flagged `contact-uncaptured-line` (never
 * silently dropped - the uncaptured-bullet stance). Missing H1 => a hard
 * `resume-missing-name` and a null return, so a clean parse always yields a
 * contact row.
 */
function parseResumeContact(source: SourceFile, issues: ParseIssue[]): ParsedContact | null {
  const lines = source.content.split('\n');
  // H1 = a single-`#` heading (the negative lookahead rejects "## ").
  const h1Index = lines.findIndex((line) => /^#(?!#)[ \t]+\S/.test(line));
  if (h1Index === -1) {
    issues.push({
      file: source.name,
      line: 1,
      field: 'name',
      rule: 'resume-missing-name',
      message: 'resume.md is missing its "# Name" H1 line - the contact header cannot be built',
    });
    return null;
  }
  const fullName = (/^#(?!#)[ \t]+(.+?)\s*$/.exec(lines[h1Index] ?? '')?.[1] ?? '').trim();

  let regionEnd = lines.length;
  for (let i = h1Index + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i] ?? '')) {
      regionEnd = i;
      break;
    }
  }

  let headline: string | null = null;
  let phone: string | null = null;
  let email: string | null = null;
  let location: string | null = null;
  const links: ParsedContactLink[] = [];

  for (let i = h1Index + 1; i < regionEnd; i++) {
    const body = (lines[i] ?? '').trim();
    if (body === '') continue;
    if (body.startsWith('>')) continue; // blockquote (the example's FICTIONAL note)
    const lineNo = i + 1;

    const link = CONTACT_LINK.exec(body);
    if (link) {
      const label = (link[1] ?? '').trim();
      const url = (link[2] ?? '').trim();
      if (/^tel:/i.test(url) && phone === null) {
        phone = label;
      } else if (/^mailto:/i.test(url) && email === null) {
        email = label;
      } else {
        links.push({ label, url });
      }
      continue;
    }

    const bold = BOLD_LINE.exec(body);
    if (bold?.[1] !== undefined && headline === null) {
      headline = bold[1].trim();
      continue;
    }

    // First plain (non-bold) line is the location; a bold line here means the
    // headline was already taken, so it falls through to the guard below.
    if (location === null && !body.startsWith('**')) {
      location = body;
      continue;
    }

    issues.push({
      file: source.name,
      line: lineNo,
      field: 'contact',
      rule: 'contact-uncaptured-line',
      message: `contact block has an unclassified line - expected a bold headline, tel:/mailto:/other links, and one plain location line`,
    });
  }

  return { fullName, headline, phone, email, location, links };
}

/**
 * Paragraphs (blank-line separated) under "## Professional Summary", each one
 * summary block in source order. Wrapped lines within a paragraph join with a
 * single space (markdown soft-break semantics). Missing section => zero blocks,
 * no issue (a resume without a summary is valid). Pure prose - nothing here can
 * be malformed, so it takes no issues sink.
 */
function parseResumeSummary(source: SourceFile): ParsedSummary[] {
  const lines = source.content.split('\n');
  const start = lines.findIndex((line) => /^##\s+Professional Summary\s*$/.test(line));
  if (start === -1) return [];

  const summaries: ParsedSummary[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    summaries.push({ text: current.join(' ').trim(), position: summaries.length });
    current = [];
  };
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^##\s/.test(line)) break;
    if (line.trim() === '') {
      flush();
      continue;
    }
    current.push(line.trim());
  }
  flush();
  return summaries;
}

/** "2012" / "2008 - 2012" / "2016 - Present" (end NULL). null = unparseable. */
function parseEducationPeriod(raw: string): { startYear: number; endYear: number | null } | null {
  const single = /^(\d{4})$/.exec(raw);
  if (single?.[1]) return { startYear: Number(single[1]), endYear: null };
  // ASCII hyphen ranges only (the plan's source-byte discipline for new code).
  // A real resume that uses an en/em dash would surface at the M6-01 real-import
  // smoke and be added then as a generic rule + fictional fixture.
  const range = /^(\d{4})\s*-\s*(\d{4})$/.exec(raw);
  if (range?.[1] && range[2]) return { startYear: Number(range[1]), endYear: Number(range[2]) };
  const toPresent = /^(\d{4})\s*-\s*present$/i.exec(raw);
  if (toPresent?.[1]) return { startYear: Number(toPresent[1]), endYear: null };
  return null;
}

/**
 * Entries under "## Education": each "### Institution" opens an entry, the
 * first plain line is the credential, and a "*<period>*" line sets the year
 * range. An unparseable period => `education-period-unparseable`; any other
 * unrecognized non-empty line => `education-uncaptured-line` (silent-omission
 * guard). Missing section => zero rows. Mirrors parseResumeExperiences' outer
 * loop (body lines are re-visited but skipped - only `###`/`##` act).
 */
function parseResumeEducation(source: SourceFile, issues: ParseIssue[]): ParsedEducation[] {
  const lines = source.content.split('\n');
  const start = lines.findIndex((line) => /^##\s+Education\s*$/.test(line));
  if (start === -1) return [];

  const education: ParsedEducation[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^##\s/.test(line)) break; // next top-level section
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (!heading?.[1]) continue;

    const institution = heading[1].trim();
    let credential: string | null = null;
    let startYear: number | null = null;
    let endYear: number | null = null;
    let periodSeen = false;

    for (let j = i + 1; j < lines.length && !/^##{1,2}\s/.test(lines[j] ?? ''); j++) {
      const body = (lines[j] ?? '').trim();
      if (body === '') continue;
      if (body.startsWith('>')) continue; // blockquote
      const lineNo = j + 1;

      const periodMatch = /^\*([^*].*?)\*$/.exec(body);
      if (periodMatch?.[1] !== undefined && !periodSeen) {
        periodSeen = true;
        const parsed = parseEducationPeriod(periodMatch[1].trim());
        if (parsed === null) {
          issues.push({
            file: source.name,
            line: lineNo,
            field: 'period',
            rule: 'education-period-unparseable',
            message: `education entry "${institution}" has an unparseable period "${periodMatch[1].trim()}" - expected "YYYY", "YYYY - YYYY", or "YYYY - Present"`,
          });
          continue;
        }
        startYear = parsed.startYear;
        endYear = parsed.endYear;
        continue;
      }

      if (credential === null && periodMatch === null) {
        credential = body;
        continue;
      }

      issues.push({
        file: source.name,
        line: lineNo,
        field: 'education',
        rule: 'education-uncaptured-line',
        message: `education entry "${institution}" has an unrecognized line - expected a credential line and an optional "*<period>*"`,
      });
    }

    education.push({ institution, credential, startYear, endYear, position: education.length });
  }

  return education;
}

const SKILLS_HEADER = ['skill', 'category', 'level', 'years', 'last used'];

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function parseSkillsTable(source: SourceFile, issues: ParseIssue[]): ParsedSkill[] {
  const lines = source.content.split('\n');
  const skills: ParsedSkill[] = [];
  const seenNames = new Map<string, number>();

  const headerIndex = lines.findIndex(
    (line) =>
      line.trim().startsWith('|') &&
      splitTableRow(line)
        .map((cell) => cell.toLowerCase())
        .join(',') === SKILLS_HEADER.join(','),
  );
  if (headerIndex === -1) {
    issues.push({
      file: source.name,
      line: 1,
      field: 'skills-table',
      rule: 'missing-table',
      message: `no skills table found — expected a header row "| ${['Skill', 'Category', 'Level', 'Years', 'Last used'].join(' | ')} |"`,
    });
    return skills;
  }

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();
    if (!line.startsWith('|')) break; // table ended
    if (/^\|[\s:|-]+\|$/.test(line)) continue; // separator row
    const lineNo = i + 1;
    const cells = splitTableRow(line);
    if (cells.length !== SKILLS_HEADER.length) {
      issues.push({
        file: source.name,
        line: lineNo,
        field: 'skills-row',
        rule: 'column-count',
        message: `expected ${SKILLS_HEADER.length} columns, found ${cells.length}`,
      });
      continue;
    }
    const [name = '', categoryRaw = '', levelRaw = '', yearsRaw = '', lastUsedRaw = ''] = cells;

    if (name === '') {
      issues.push({
        file: source.name,
        line: lineNo,
        field: 'skill-name',
        rule: 'empty-name',
        message: 'skill name is empty',
      });
      continue;
    }
    const firstSeen = seenNames.get(name.toLowerCase());
    if (firstSeen !== undefined) {
      issues.push({
        file: source.name,
        line: lineNo,
        field: 'skill-name',
        rule: 'duplicate-entry',
        message: `duplicate skill "${name}" (first at line ${firstSeen})`,
      });
      continue;
    }
    seenNames.set(name.toLowerCase(), lineNo);

    let rowValid = true;
    if (!(SKILL_LEVELS as readonly string[]).includes(levelRaw)) {
      issues.push({
        file: source.name,
        line: lineNo,
        field: 'level',
        rule: 'invalid-value',
        message: `invalid level "${levelRaw}" for skill "${name}" — expected one of ${SKILL_LEVELS.join(', ')}`,
      });
      rowValid = false;
    }
    if (yearsRaw !== '' && !/^\d+$/.test(yearsRaw)) {
      issues.push({
        file: source.name,
        line: lineNo,
        field: 'years',
        rule: 'invalid-value',
        message: `invalid years "${yearsRaw}" for skill "${name}" — expected a whole number or blank`,
      });
      rowValid = false;
    }
    let lastUsed: string | null = null;
    if (lastUsedRaw !== '') {
      const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(lastUsedRaw);
      if (match) {
        lastUsed = `${lastUsedRaw}-01`;
      } else {
        issues.push({
          file: source.name,
          line: lineNo,
          field: 'last-used',
          rule: 'invalid-value',
          message: `invalid last-used "${lastUsedRaw}" for skill "${name}" — expected YYYY-MM or blank`,
        });
        rowValid = false;
      }
    }
    if (!rowValid) continue;

    skills.push({
      name,
      category: categoryRaw === '' ? null : categoryRaw,
      level: levelRaw as SkillLevel,
      years: yearsRaw === '' ? null : Number(yearsRaw),
      lastUsed,
    });
  }

  if (skills.length === 0 && issues.every((issue) => issue.file !== source.name)) {
    issues.push({
      file: source.name,
      line: headerIndex + 1,
      field: 'skills-table',
      rule: 'empty-table',
      message: 'skills table has no data rows',
    });
  }

  return skills;
}

function parseProjects(
  source: SourceFile,
  issues: ParseIssue[],
  options: { experiences: ParsedExperience[] | null },
): ParsedProject[] {
  const lines = source.content.split('\n');
  const projects: ParsedProject[] = [];
  const seenNames = new Map<string, number>();
  const knownCompanies = new Set(
    (options.experiences ?? []).map((experience) => experience.company.toLowerCase()),
  );

  for (let i = 0; i < lines.length; i++) {
    const heading = /^##\s+(.+?)\s*$/.exec(lines[i] ?? '');
    if (!heading?.[1]) continue;
    const name = heading[1];
    const headingLine = i + 1;

    let company: string | null = null;
    let provenance: { raw: string; line: number } | undefined;
    let summary: string | null = null;
    for (let j = i + 1; j < lines.length && !/^##\s/.test(lines[j] ?? ''); j++) {
      const body = (lines[j] ?? '').trim();
      const field = /^\*\*(Company|Role|Period|Provenance):\*\*\s*(.*)$/.exec(body);
      if (field?.[1] === 'Company' && field[2] !== undefined && company === null) {
        company = field[2].trim() || null;
      }
      if (field?.[1] === 'Provenance' && field[2] !== undefined && provenance === undefined) {
        provenance = { raw: field[2].trim(), line: j + 1 };
      }
      // Summary = the first plain paragraph line (the entry's description);
      // headings, fields, blockquotes, and rules don't qualify.
      if (
        summary === null &&
        body !== '' &&
        !field &&
        !/^#{1,6}\s/.test(body) &&
        !body.startsWith('>') &&
        !/^-{3,}$/.test(body) &&
        !body.startsWith('**') &&
        !/^[-*]\s/.test(body) &&
        !body.startsWith('`')
      ) {
        summary = body;
      }
    }

    if (provenance === undefined) {
      issues.push({
        file: source.name,
        line: headingLine,
        field: 'provenance',
        rule: 'missing-field',
        message: `project "${name}" is missing its "**Provenance:**" line — expected one of ${PROJECT_PROVENANCES.join(', ')}`,
      });
      continue;
    }
    if (!(PROJECT_PROVENANCES as readonly string[]).includes(provenance.raw)) {
      issues.push({
        file: source.name,
        line: provenance.line,
        field: 'provenance',
        rule: 'invalid-value',
        message: `invalid provenance "${provenance.raw}" for project "${name}" — expected one of ${PROJECT_PROVENANCES.join(', ')}`,
      });
      continue;
    }

    if (provenance.raw === 'professional') {
      if (company === null) {
        issues.push({
          file: source.name,
          line: headingLine,
          field: 'company',
          rule: 'missing-field',
          message: `professional project "${name}" is missing its "**Company:**" line`,
        });
        continue;
      }
      // Approved policy: a typo'd/renamed company is a hard error, not a
      // silently unlinked import.
      if (options.experiences !== null && !knownCompanies.has(company.toLowerCase())) {
        issues.push({
          file: source.name,
          line: headingLine,
          field: 'company',
          rule: 'unknown-company',
          message: `professional project "${name}" names company "${company}" with no matching experience in resume.md`,
        });
        continue;
      }
    }

    const firstSeen = seenNames.get(name.toLowerCase());
    if (firstSeen !== undefined) {
      issues.push({
        file: source.name,
        line: headingLine,
        field: 'project',
        rule: 'duplicate-entry',
        message: `duplicate project "${name}" (first at line ${firstSeen})`,
      });
      continue;
    }
    seenNames.set(name.toLowerCase(), headingLine);

    projects.push({
      name,
      company,
      provenance: provenance.raw as ProjectProvenance,
      summary,
    });
  }

  return projects;
}
