import { tokenizeForMatching } from '@careerforge/core';
import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATIVE_FACT_PATTERNS,
  classifyDurableFact,
  locationStanceClause,
  matchAdministrative,
} from './profile-fact.ts';

// M12-03: direct unit coverage of the durable-fact evaluator. All fictional
// (RISKS P-01), ASCII-only (source-byte law). classifyGaps integration lives in
// classify-gaps.category-routing.test.ts; this pins the primitives.

const toks = (text: string) => tokenizeForMatching(text);

describe('matchAdministrative phrase -> fact-kind map (single source of truth)', () => {
  it('EVERY committed work-auth spelling maps to work_authorization (correctness#2)', () => {
    for (const text of [
      'work authorization required',
      'must be authorized to work here',
      'authorization to work in the country',
      'US citizenship required',
    ]) {
      expect(matchAdministrative(toks(text))?.kind).toBe('work_authorization');
    }
  });

  it('visa / sponsorship map to visa_sponsorship_needed; clearance to security_clearance', () => {
    expect(matchAdministrative(toks('visa status'))?.kind).toBe('visa_sponsorship_needed');
    expect(matchAdministrative(toks('sponsorship not available'))?.kind).toBe(
      'visa_sponsorship_needed',
    );
    expect(matchAdministrative(toks('active security clearance'))?.kind).toBe('security_clearance');
    expect(matchAdministrative(toks('clearance required'))?.kind).toBe('security_clearance');
  });

  it('background check / drug screen are recognized but UNMAPPED (kind null)', () => {
    for (const text of [
      'background check required',
      'drug screen required',
      'drug screening policy',
      'drug testing on hire',
    ]) {
      const match = matchAdministrative(toks(text));
      expect(match).toBeDefined();
      expect(match?.kind).toBeNull();
    }
  });

  it('a non-administrative requirement matches nothing', () => {
    expect(matchAdministrative(toks('Senior TypeScript engineer'))).toBeUndefined();
    // token-level, not substring: "visualization" never fires "visa".
    expect(matchAdministrative(toks('data visualization dashboards'))).toBeUndefined();
  });

  it('every mapped kind in the table is a real fact kind or null', () => {
    for (const pattern of ADMINISTRATIVE_FACT_PATTERNS) {
      expect(pattern.phrase.length).toBeGreaterThan(0);
      expect(
        pattern.kind === null ||
          ['work_authorization', 'visa_sponsorship_needed', 'security_clearance'].includes(
            pattern.kind,
          ),
      ).toBe(true);
    }
  });
});

describe('classifyDurableFact: work_authorization', () => {
  const wa = (reqText: string, value: string | undefined) =>
    classifyDurableFact('work_authorization', toks(reqText), value);

  it('absent => unknown/low with a declare affordance', () => {
    const r = wa('Must have work authorization', undefined);
    expect(r.classification).toBe('unknown');
    expect(r.confidence).toBe('low');
    expect(r.rationale).toContain('facts.md');
  });

  it('country CORROBORATED (spelled-out country on both sides) => satisfied_fact/high', () => {
    const r = wa('Authorized to work in the United States', 'citizen of the United States');
    expect(r.classification).toBe('satisfied_fact');
    expect(r.confidence).toBe('high');
  });

  it('no recognized country on a side => satisfied_fact/medium (declared, not country-proven)', () => {
    // Bare abbreviations (US/UK/EU) are intentionally NOT country tokens - they
    // collide with common words (the pronoun "us") - so an abbreviation-only
    // pair corroborates at medium, never a false conflict.
    expect(wa('Must be authorized to work', 'Authorized to work, permanent').confidence).toBe(
      'medium',
    );
    expect(wa('Authorized to work in the US', 'authorized in the US').confidence).toBe('medium');
  });

  it('country CONFLICT (spelled-out, different) => unknown', () => {
    const r = wa(
      'Authorized to work in the United States',
      'Authorized in the European Union only',
    );
    expect(r.classification).toBe('unknown');
  });

  it('the pronoun "us" never manufactures a conflict or false satisfy (code review)', () => {
    // "join us" must not read as the US country group and flip a legit EU value
    // into a spurious conflict.
    const r = wa(
      'Must have authorization to work; join us today',
      'Authorized in the European Union only',
    );
    expect(r.classification).toBe('satisfied_fact');
    expect(r.confidence).toBe('medium');
  });
});

describe('classifyDurableFact: visa_sponsorship_needed (affirmative-only detection)', () => {
  const visa = (reqText: string, value: string | undefined) =>
    classifyDurableFact('visa_sponsorship_needed', toks(reqText), value);

  it('no => satisfied_fact regardless of the posting phrasing', () => {
    expect(visa('Visa sponsorship not available', 'no').classification).toBe('satisfied_fact');
    expect(visa('We do not sponsor visas', 'no').classification).toBe('satisfied_fact');
  });

  it('yes + a NEGATIVE/bare posting => unknown (never a silenced satisfy) - blocker#1', () => {
    for (const reqText of [
      // negation BETWEEN the phrase tokens (strict adjacency breaks the match)
      'Visa sponsorship not available',
      'We will not sponsor work visas',
      // negation BEFORE an affirmative verb-object phrase (the NEGATION_CUES
      // guard catches these; strict adjacency alone would fail OPEN - the
      // blocker#1 regression the code review found)
      'We do not offer sponsorship',
      'We are unable to offer sponsorship',
      'We cannot provide sponsorship',
      'We do not provide visa sponsorship',
      'No sponsorship available',
      'We no longer offer visa sponsorship',
      // bare mention, no affirmative offer at all
      'This role requires a visa',
    ]) {
      expect(visa(reqText, 'yes').classification).toBe('unknown');
    }
  });

  it('yes + an AFFIRMATIVE offer => satisfied_fact', () => {
    for (const reqText of [
      'Visa sponsorship available',
      'Sponsorship is available for this role',
      'We will sponsor qualified candidates',
      'We provide visa sponsorship',
    ]) {
      expect(visa(reqText, 'yes').classification).toBe('satisfied_fact');
    }
  });

  it('absent => unknown', () => {
    expect(visa('Visa sponsorship available', undefined).classification).toBe('unknown');
  });
});

describe('classifyDurableFact: security_clearance is never auto-satisfied', () => {
  const clr = (value: string | undefined) =>
    classifyDurableFact('security_clearance', toks('Active security clearance required'), value);

  it('present (a held level) => unknown (confirm the level; comparison deferred)', () => {
    expect(clr('Top Secret').classification).toBe('unknown');
  });

  it('present (none/negative) => unknown (you have declared you do not hold one)', () => {
    const r = clr('none');
    expect(r.classification).toBe('unknown');
    expect(r.rationale).toContain('do not hold');
  });

  it('absent => unknown', () => {
    expect(clr(undefined).classification).toBe('unknown');
  });
});

describe('locationStanceClause', () => {
  it('renders relocation + remote clauses; empty when neither declared', () => {
    expect(locationStanceClause('open_for_right_opportunity', undefined)).toContain('right role');
    expect(locationStanceClause(undefined, 'prefer_remote')).toContain('remote');
    expect(locationStanceClause(undefined, undefined)).toBe('');
    // Unknown value (should not happen past zod) yields no clause, never throws.
    expect(locationStanceClause('bogus', undefined)).toBe('');
  });
});
