// Pure parser tests. Sources are docs/profile.example/ (fictional) and the
// deliberately malformed fictional fixture — never the real docs/profile/
// (RISKS P-01).
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXAMPLE_PROFILE_DIR, MALFORMED_PROFILE_DIR } from './fixture-dirs.ts';
import { ProfileParseError } from './parse-errors.ts';
import { parseProfile, type SourceFile } from './profile-parser.ts';

async function loadSources(dir: string) {
  const load = async (name: string): Promise<SourceFile> => ({
    name,
    content: await readFile(path.join(dir, name), 'utf8'),
  });
  return {
    resume: await load('resume.md'),
    skills: await load('skills.md'),
    projects: await load('projects.md'),
  };
}

function issuesOf(fn: () => unknown): ProfileParseError['issues'] {
  try {
    fn();
  } catch (error) {
    if (error instanceof ProfileParseError) return error.issues;
    throw error;
  }
  throw new Error('expected ProfileParseError');
}

// Minimal well-formed sources for targeted mutations (all fictional).
const VALID = {
  resume: {
    name: 'resume.md',
    content: [
      '# Alex Rivera',
      '',
      '## Professional Experience',
      '',
      '### Senior Software Engineer',
      '',
      '**Acme Analytics Co.** — Springfield',
      '*March 2020 - Present*',
      '',
      '### Application Developer',
      '',
      '**Globex Logistics**',
      '*2016 - 2020*',
      '',
      '## Education',
    ].join('\n'),
  },
  skills: {
    name: 'skills.md',
    content: [
      '# Skills',
      '',
      '| Skill | Category | Level | Years | Last used |',
      '| --- | --- | --- | --- | --- |',
      '| TypeScript | language | expert | 8 |  |',
      '| Python |  | rusty |  | 2016-01 |',
    ].join('\n'),
  },
  projects: {
    name: 'projects.md',
    content: [
      '# Projects',
      '',
      '## Reporting Dashboard Modernization',
      '',
      '**Company:** Acme Analytics Co.',
      '**Provenance:** professional',
      '',
      'Modernized a fictional reporting platform.',
      '',
      '## Garden Tracker',
      '',
      '**Provenance:** personal_ai_assisted',
      '',
      'A fictional garden planning app.',
    ].join('\n'),
  },
};

describe('parseProfile on docs/profile.example/', () => {
  it('parses the full fictional example profile', async () => {
    const parsed = parseProfile(await loadSources(EXAMPLE_PROFILE_DIR));

    expect(parsed.skills).toHaveLength(8);
    expect(parsed.skills[0]).toEqual({
      name: 'TypeScript',
      category: 'language',
      level: 'expert',
      years: 8,
      lastUsed: null,
    });
    expect(parsed.skills.at(-1)).toEqual({
      name: 'Python',
      category: 'language',
      level: 'rusty',
      years: 4,
      lastUsed: '2016-01-01',
    });

    expect(parsed.experiences).toEqual([
      {
        company: 'Acme Analytics Co.',
        title: 'Senior Software Engineer',
        startDate: '2020-03-01',
        endDate: null,
      },
      {
        company: 'Globex Logistics',
        title: 'Application Developer',
        startDate: '2016-01-01',
        endDate: '2020-12-31',
      },
      {
        company: 'Initech Games',
        title: 'QA Automation Engineer',
        startDate: '2012-01-01',
        endDate: '2016-12-31',
      },
    ]);

    expect(parsed.projects).toEqual([
      {
        name: 'Reporting Dashboard Modernization',
        company: 'Acme Analytics Co.',
        provenance: 'professional',
        summary:
          'Modernized a data-intensive internal reporting platform used by account managers.',
      },
      {
        name: 'API Caching Layer',
        company: 'Acme Analytics Co.',
        provenance: 'professional',
        summary: 'Designed a Redis caching strategy for frequently requested reporting endpoints.',
      },
      {
        name: 'Driver Notification Service',
        company: 'Globex Logistics',
        provenance: 'professional',
        summary: 'Built the notification backend for a driver-facing mobile app.',
      },
    ]);
  });
});

describe('parse failures report file + line, never silently skip', () => {
  it('reports every issue in the malformed fixture with its file and line', async () => {
    const sources = await loadSources(MALFORMED_PROFILE_DIR);
    const issues = issuesOf(() => parseProfile(sources));

    expect(issues).toEqual([
      {
        file: 'resume.md',
        line: 17,
        field: 'period',
        rule: 'invalid-value',
        message: expect.stringContaining('unparseable period "whenever - sometime"') as string,
      },
      {
        file: 'skills.md',
        line: 8,
        field: 'level',
        rule: 'invalid-value',
        message: expect.stringContaining('invalid level "legendary"') as string,
      },
      {
        file: 'projects.md',
        line: 5,
        field: 'provenance',
        rule: 'missing-field',
        message: expect.stringContaining('missing its "**Provenance:**" line') as string,
      },
    ]);
  });

  it('rejects an invalid provenance value at its line', () => {
    const projects = {
      name: 'projects.md',
      content: VALID.projects.content.replace('personal_ai_assisted', 'homemade'),
    };
    const issues = issuesOf(() => parseProfile({ ...VALID, projects }));
    expect(issues).toEqual([
      {
        file: 'projects.md',
        line: 12,
        field: 'provenance',
        rule: 'invalid-value',
        message: expect.stringContaining('invalid provenance "homemade"') as string,
      },
    ]);
  });

  it('hard-errors a professional project whose company has no experience (approved link policy)', () => {
    const projects = {
      name: 'projects.md',
      content: VALID.projects.content.replace('Acme Analytics Co.', 'Umbrella Corp.'),
    };
    const issues = issuesOf(() => parseProfile({ ...VALID, projects }));
    expect(issues).toEqual([
      {
        file: 'projects.md',
        line: 3,
        field: 'company',
        rule: 'unknown-company',
        message: expect.stringContaining(
          'names company "Umbrella Corp." with no matching experience',
        ) as string,
      },
    ]);
  });

  it('rejects duplicate skills case-insensitively (natural key preview)', () => {
    const skills = {
      name: 'skills.md',
      content: `${VALID.skills.content}\n| typescript | language | solid | 2 |  |`,
    };
    const issues = issuesOf(() => parseProfile({ ...VALID, skills }));
    expect(issues).toEqual([
      {
        file: 'skills.md',
        line: 7,
        field: 'skill-name',
        rule: 'duplicate-entry',
        message: expect.stringContaining('duplicate skill "typescript"') as string,
      },
    ]);
  });

  it('reports a missing Professional Experience section and suppresses knock-on link errors', () => {
    const resume = { name: 'resume.md', content: '# Alex Rivera\n\n## Education\n' };
    const issues = issuesOf(() => parseProfile({ ...VALID, resume }));
    expect(issues).toEqual([
      {
        file: 'resume.md',
        line: 1,
        field: 'professional-experience',
        rule: 'missing-section',
        message: 'missing "## Professional Experience" section',
      },
    ]);
  });

  it('reports a missing skills table', () => {
    const skills = { name: 'skills.md', content: '# Skills\n\nno table here\n' };
    const issues = issuesOf(() => parseProfile({ ...VALID, skills }));
    expect(issues).toEqual([
      {
        file: 'skills.md',
        line: 1,
        field: 'skills-table',
        rule: 'missing-table',
        message: expect.stringContaining('no skills table found') as string,
      },
    ]);
  });
});
