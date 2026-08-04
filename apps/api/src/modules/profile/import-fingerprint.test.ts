import { describe, expect, it } from 'vitest';

import { computeSourceFingerprint, type FingerprintSources } from './import-fingerprint.ts';

const base = (): FingerprintSources => ({
  resume: { name: 'resume.md', content: 'resume body' },
  skills: { name: 'skills.md', content: 'skills body' },
  projects: { name: 'projects.md', content: 'projects body' },
  criteria: { name: 'job-criteria.md', content: 'criteria body' },
  facts: { name: 'facts.md', content: 'facts body' },
});

describe('computeSourceFingerprint (M13-09)', () => {
  it('is deterministic: identical bytes -> identical digest', () => {
    expect(computeSourceFingerprint(base())).toBe(computeSourceFingerprint(base()));
  });

  it('is a 64-hex sha256 and reveals no content (value-free)', () => {
    const fp = computeSourceFingerprint(base());
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
    expect(fp).not.toContain('resume body');
  });

  it('changes when ANY source byte changes', () => {
    const changed = base();
    changed.skills = { name: 'skills.md', content: 'skills body!' };
    expect(computeSourceFingerprint(changed)).not.toBe(computeSourceFingerprint(base()));
  });

  it('distinguishes absent facts.md from an empty facts.md (length-prefix framing)', () => {
    const absent = { ...base(), facts: null };
    const empty = { ...base(), facts: { name: 'facts.md', content: '' } };
    expect(computeSourceFingerprint(absent)).not.toBe(computeSourceFingerprint(empty));
  });

  it('cannot be spoofed by shifting bytes across the file boundary', () => {
    // "ab"|"c" vs "a"|"bc": a naive concatenation would collide; the per-file
    // length prefix keeps them distinct.
    const left = base();
    left.resume = { name: 'resume.md', content: 'ab' };
    left.skills = { name: 'skills.md', content: 'c' };
    const right = base();
    right.resume = { name: 'resume.md', content: 'a' };
    right.skills = { name: 'skills.md', content: 'bc' };
    expect(computeSourceFingerprint(left)).not.toBe(computeSourceFingerprint(right));
  });
});
