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
}

export interface ParsedProject {
  name: string;
  /** Verbatim **Company:** value; null when absent (personal provenance). */
  company: string | null;
  provenance: ProjectProvenance;
  summary: string | null;
}

export interface ParsedProfile {
  skills: ParsedSkill[];
  experiences: ParsedExperience[];
  projects: ParsedProject[];
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
  const resumeIssuesBefore = issues.length;
  const experiences = parseResumeExperiences(sources.resume, issues);
  const resumeParsedClean = issues.length === resumeIssuesBefore;
  const skills = parseSkillsTable(sources.skills, issues);
  const projects = parseProjects(sources.projects, issues, {
    // Suppress link errors when resume.md itself failed — they'd be noise on
    // top of the real problem.
    experiences: resumeParsedClean ? experiences : null,
  });
  if (issues.length > 0) throw new ProfileParseError(issues);
  return { skills, experiences, projects };
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
    for (let j = i + 1; j < lines.length && !/^##{1,2}\s/.test(lines[j] ?? ''); j++) {
      const body = (lines[j] ?? '').trim();
      // "**Acme Analytics Co.** — Springfield" (location optional, unparsed).
      const companyMatch = /^\*\*(.+?)\*\*(?:\s*[—–-]\s*.*)?$/.exec(body);
      if (companyMatch?.[1] && company === undefined) company = companyMatch[1].trim();
      // "*March 2020 - Present*" (single asterisks).
      const periodMatch = /^\*([^*].*?)\*$/.exec(body);
      if (periodMatch?.[1] && period === undefined) period = { raw: periodMatch[1], line: j + 1 };
    }

    if (company === undefined) {
      issues.push({
        file: source.name,
        line: headingLine,
        message: `experience "${title}" is missing its "**Company**" line`,
      });
    }
    if (period === undefined) {
      issues.push({
        file: source.name,
        line: headingLine,
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
        message: `duplicate experience "${title}" at "${company}" starting ${startDate} (first at line ${firstSeen})`,
      });
      continue;
    }
    seenKeys.set(key, headingLine);
    experiences.push({ company, title, startDate, endDate: end.endDate });
  }

  return experiences;
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
        message: `expected ${SKILLS_HEADER.length} columns, found ${cells.length}`,
      });
      continue;
    }
    const [name = '', categoryRaw = '', levelRaw = '', yearsRaw = '', lastUsedRaw = ''] = cells;

    if (name === '') {
      issues.push({ file: source.name, line: lineNo, message: 'skill name is empty' });
      continue;
    }
    const firstSeen = seenNames.get(name.toLowerCase());
    if (firstSeen !== undefined) {
      issues.push({
        file: source.name,
        line: lineNo,
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
        message: `invalid level "${levelRaw}" for skill "${name}" — expected one of ${SKILL_LEVELS.join(', ')}`,
      });
      rowValid = false;
    }
    if (yearsRaw !== '' && !/^\d+$/.test(yearsRaw)) {
      issues.push({
        file: source.name,
        line: lineNo,
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
        message: `project "${name}" is missing its "**Provenance:**" line — expected one of ${PROJECT_PROVENANCES.join(', ')}`,
      });
      continue;
    }
    if (!(PROJECT_PROVENANCES as readonly string[]).includes(provenance.raw)) {
      issues.push({
        file: source.name,
        line: provenance.line,
        message: `invalid provenance "${provenance.raw}" for project "${name}" — expected one of ${PROJECT_PROVENANCES.join(', ')}`,
      });
      continue;
    }

    if (provenance.raw === 'professional') {
      if (company === null) {
        issues.push({
          file: source.name,
          line: headingLine,
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
