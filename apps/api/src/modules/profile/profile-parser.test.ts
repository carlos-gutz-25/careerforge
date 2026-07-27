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
        bullets: [
          'Led migration of a reporting dashboard from Vue 2 to Vue 3 with Pinia, improving render performance of large data tables by 25%.',
          'Cut p95 latency of the top five API endpoints from 1.8 seconds to 90 milliseconds by introducing a Redis cache in front of warehouse queries.',
          'Maintained CI/CD pipelines and feature-flagged releases across three applications.',
        ],
      },
      {
        company: 'Globex Logistics',
        title: 'Application Developer',
        startDate: '2016-01-01',
        endDate: '2020-12-31',
        bullets: [
          'Built Node.js APIs for a driver-facing mobile app, developed with test-driven development.',
          'Implemented event producers and consumers integrating with two third-party fulfillment services.',
          'Shipped a notification service that measurably increased weekly active users.',
        ],
      },
      {
        company: 'Initech Games',
        title: 'QA Automation Engineer',
        startDate: '2012-01-01',
        endDate: '2016-12-31',
        bullets: [
          'Built Python-based UI test automation, reducing manual regression effort by roughly 400 hours per quarter.',
          'Grew from QA tester to automation lead coordinating a team of six.',
        ],
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

    // M6-01: the resume header facts.
    expect(parsed.contact).toEqual({
      fullName: 'Alex Rivera',
      headline: 'Senior Software Engineer',
      phone: '555-010-0100',
      email: 'alex.rivera.example@example.com',
      location: 'Springfield, USA',
      links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/example-alex-rivera/' }],
    });
    expect(parsed.summaries).toEqual([
      {
        text: 'Senior Software Engineer with a decade of experience building full-stack web applications. Skilled in TypeScript, Node.js, and Vue.js, with hands-on experience in API design, caching, and data-heavy dashboards. Ships tested, maintainable code and collaborates across teams.',
        position: 0,
      },
    ]);
    expect(parsed.education).toEqual([
      {
        institution: 'Springfield State University',
        credential: 'B.S. Computer Science',
        startYear: 2008,
        endYear: 2012,
        position: 0,
      },
    ]);
  });
});

// M2-12: experience-bullet capture + the silent-omission guard. All fictional.
function resumeWithAcmeBody(bodyLines: string[]): SourceFile {
  return {
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
      ...bodyLines,
      '',
      '## Education',
    ].join('\n'),
  };
}

describe('experience-bullet capture (M2-12)', () => {
  it('captures top-level hyphen bullets verbatim — bold/emphasis inside does NOT cross-contaminate company/period', () => {
    const resume = resumeWithAcmeBody([
      '',
      '- **Led** a fictional team of six.',
      '- Shipped *fictional* features.',
    ]);
    const parsed = parseProfile({ ...VALID, resume });
    // The `- **Led**` line is captured as a BULLET (markdown kept), never
    // mistaken for the `**Company**` line; company + period still parse.
    expect(parsed.experiences).toEqual([
      {
        company: 'Acme Analytics Co.',
        title: 'Senior Software Engineer',
        startDate: '2020-03-01',
        endDate: null,
        bullets: ['**Led** a fictional team of six.', 'Shipped *fictional* features.'],
      },
    ]);
  });

  it('a zero-bullet experience is valid (no bullets → [], no issue)', () => {
    const parsed = parseProfile({ ...VALID, resume: resumeWithAcmeBody([]) });
    expect(parsed.experiences[0]?.bullets).toEqual([]);
  });

  it('PLANTED-FAIL: an indented sub-bullet the flat capture cannot take flags uncaptured-bullet', () => {
    const resume = resumeWithAcmeBody([
      '',
      '- Top-level fictional bullet.',
      '  - Nested fictional sub-bullet.',
    ]);
    const issues = issuesOf(() => parseProfile({ ...VALID, resume }));
    expect(issues).toEqual([
      {
        file: 'resume.md',
        line: 11, // the indented sub-bullet
        field: 'bullets',
        rule: 'uncaptured-bullet',
        message: expect.stringContaining('bullet-shaped line') as string,
      },
    ]);
  });

  it('PLANTED-FAIL: a non-hyphen (*) bullet marker flags uncaptured-bullet', () => {
    const resume = resumeWithAcmeBody(['', '* Asterisk-marker fictional bullet.']);
    const issues = issuesOf(() => parseProfile({ ...VALID, resume }));
    expect(issues).toEqual([
      {
        file: 'resume.md',
        line: 10,
        field: 'bullets',
        rule: 'uncaptured-bullet',
        message: expect.stringContaining('bullet-shaped line') as string,
      },
    ]);
  });

  it('bullets in a later resume section (Technical Skills) do NOT enter the experience body or trip the guard', () => {
    const resume = {
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
        '- Acme fictional bullet.',
        '',
        '## Technical Skills',
        '',
        '- **Languages:** TypeScript, Python',
        '- **Tools:** Docker',
        '',
        '## Education',
      ].join('\n'),
    };
    const parsed = parseProfile({ ...VALID, resume });
    // Only the experience-body bullet is captured; the Technical Skills bullets
    // are past the next `##`, so the guard never sees them.
    expect(parsed.experiences[0]?.bullets).toEqual(['Acme fictional bullet.']);
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

// M6-01: contact / summary / education parsing. All fictional (RISKS P-01).
const EXPERIENCE_BLOCK = [
  '## Professional Experience',
  '',
  '### Senior Software Engineer',
  '',
  '**Acme Analytics Co.**',
  '*2016 - 2020*',
];

/** A resume whose contact region (between the H1 and the first section) is the
 *  given lines, followed by a minimal valid experience so the parse succeeds. */
function resumeWithContact(contactLines: string[]): SourceFile {
  return {
    name: 'resume.md',
    content: ['# Alex Rivera', '', ...contactLines, '', ...EXPERIENCE_BLOCK].join('\n'),
  };
}

describe('contact block parsing (M6-01)', () => {
  it('classifies headline, tel/mailto/other links, and the plain location line', () => {
    const resume = resumeWithContact([
      '**Senior Software Engineer**',
      '',
      '[555-010-0100](tel:+15550100100)',
      '[alex@example.com](mailto:alex@example.com)',
      'Springfield, USA',
      '[LinkedIn](https://www.linkedin.com/in/example/)',
    ]);
    const parsed = parseProfile({ ...VALID, resume });
    expect(parsed.contact).toEqual({
      fullName: 'Alex Rivera',
      headline: 'Senior Software Engineer',
      phone: '555-010-0100',
      email: 'alex@example.com',
      location: 'Springfield, USA',
      links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/example/' }],
    });
  });

  it('skips a blockquote note so it is never mistaken for headline or location', () => {
    const resume = resumeWithContact([
      '> **FICTIONAL EXAMPLE.** A banner that must not become the headline.',
      'Springfield, USA',
    ]);
    const parsed = parseProfile({ ...VALID, resume });
    expect(parsed.contact.headline).toBeNull();
    expect(parsed.contact.location).toBe('Springfield, USA');
  });

  it('PLANTED-FAIL: a resume with no H1 name flags resume-missing-name', () => {
    const resume: SourceFile = {
      name: 'resume.md',
      content: ['**Senior Software Engineer**', '', ...EXPERIENCE_BLOCK].join('\n'),
    };
    const issues = issuesOf(() => parseProfile({ ...VALID, resume }));
    expect(issues).toContainEqual({
      file: 'resume.md',
      line: 1,
      field: 'name',
      rule: 'resume-missing-name',
      message: expect.stringContaining('# Name') as string,
    });
  });

  it('PLANTED-FAIL: an unclassified contact line flags contact-uncaptured-line (never dropped)', () => {
    const resume = resumeWithContact(['Springfield, USA', 'A stray second plain line.']);
    const issues = issuesOf(() => parseProfile({ ...VALID, resume }));
    expect(issues).toContainEqual({
      file: 'resume.md',
      line: 4,
      field: 'contact',
      rule: 'contact-uncaptured-line',
      message: expect.stringContaining('unclassified line') as string,
    });
  });
});

describe('summary parsing (M6-01)', () => {
  it('parses blank-line-separated paragraphs as ordered blocks (soft wraps join)', () => {
    const resume: SourceFile = {
      name: 'resume.md',
      content: [
        '# Alex Rivera',
        '',
        '## Professional Summary',
        '',
        'First fictional paragraph line one',
        'still paragraph one after a soft wrap.',
        '',
        'Second fictional paragraph.',
        '',
        ...EXPERIENCE_BLOCK,
      ].join('\n'),
    };
    const parsed = parseProfile({ ...VALID, resume });
    expect(parsed.summaries).toEqual([
      {
        text: 'First fictional paragraph line one still paragraph one after a soft wrap.',
        position: 0,
      },
      { text: 'Second fictional paragraph.', position: 1 },
    ]);
  });

  it('yields zero summaries when the section is absent (no issue)', () => {
    const parsed = parseProfile({ ...VALID });
    expect(parsed.summaries).toEqual([]);
  });
});

describe('education parsing (M6-01)', () => {
  it('parses a full range, an open end (Present), and a single year', () => {
    const resume: SourceFile = {
      name: 'resume.md',
      content: [
        '# Alex Rivera',
        '',
        ...EXPERIENCE_BLOCK,
        '',
        '## Education',
        '',
        '### Springfield State University',
        '',
        'B.S. Computer Science',
        '*2008 - 2012*',
        '',
        '### Night School',
        '',
        'Certificate, Fictional Studies',
        '*2015 - Present*',
        '',
        '### Bootcamp',
        '',
        '*2019*',
      ].join('\n'),
    };
    const parsed = parseProfile({ ...VALID, resume });
    expect(parsed.education).toEqual([
      {
        institution: 'Springfield State University',
        credential: 'B.S. Computer Science',
        startYear: 2008,
        endYear: 2012,
        position: 0,
      },
      {
        institution: 'Night School',
        credential: 'Certificate, Fictional Studies',
        startYear: 2015,
        endYear: null,
        position: 1,
      },
      { institution: 'Bootcamp', credential: null, startYear: 2019, endYear: null, position: 2 },
    ]);
  });

  it('PLANTED-FAIL: an unparseable period flags education-period-unparseable', () => {
    const resume: SourceFile = {
      name: 'resume.md',
      content: [
        '# Alex Rivera',
        '',
        ...EXPERIENCE_BLOCK,
        '',
        '## Education',
        '',
        '### Springfield State University',
        '',
        'B.S. Computer Science',
        '*sometime in the 2000s*',
      ].join('\n'),
    };
    const issues = issuesOf(() => parseProfile({ ...VALID, resume }));
    expect(issues).toContainEqual({
      file: 'resume.md',
      line: 15,
      field: 'period',
      rule: 'education-period-unparseable',
      message: expect.stringContaining('unparseable period') as string,
    });
  });

  it('PLANTED-FAIL: an unrecognized extra line under an entry flags education-uncaptured-line', () => {
    const resume: SourceFile = {
      name: 'resume.md',
      content: [
        '# Alex Rivera',
        '',
        ...EXPERIENCE_BLOCK,
        '',
        '## Education',
        '',
        '### Springfield State University',
        '',
        'B.S. Computer Science',
        '*2008 - 2012*',
        'An unexpected extra detail line.',
      ].join('\n'),
    };
    const issues = issuesOf(() => parseProfile({ ...VALID, resume }));
    expect(issues).toContainEqual({
      file: 'resume.md',
      line: 16,
      field: 'education',
      rule: 'education-uncaptured-line',
      message: expect.stringContaining('unrecognized line') as string,
    });
  });

  it('yields zero education entries when the section is absent (no issue)', () => {
    const resume: SourceFile = {
      name: 'resume.md',
      content: ['# Alex Rivera', '', ...EXPERIENCE_BLOCK].join('\n'),
    };
    const parsed = parseProfile({ ...VALID, resume });
    expect(parsed.education).toEqual([]);
  });
});
