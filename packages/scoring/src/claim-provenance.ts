import {
  containsExternalPointer,
  RESUME_CLAIM_TEXT_MAX_CHARS,
  RESUME_MAX_CLAIMS,
  RESUME_MAX_CLAIMS_PER_EXPERIENCE,
  RESUME_MAX_CLAIMS_PER_PROJECT,
  RESUME_SUMMARY_TOTAL_MAX_CHARS,
  type ProjectProvenance,
  type ResumeClaimDraft,
} from '@careerforge/core';

import { textMatchesPhrase } from './matching.ts';

// M6-02 - the claim-provenance gate (ADR-0018). PURE like scoreFit /
// classifyGaps / suggestCriteriaAdjustments: no I/O, no clock, no randomness.
// It is the SINGLE verdict site for whether a model-drafted resume claim set may
// be written or must be flagged: M6-04's compose route calls checkClaimProvenance
// pre-insert and, on ANY violation, writes nothing and marks the run `flagged`
// (the house tripwire law). Nothing here RUNS it - this story ships the engine
// and its contracts only (V2-PLAN scope).
//
// Shape-agnostic by design (sec D2): citation/evidence refs are OPAQUE strings;
// ownership and provenance class come from the evidence catalog's `owner` /
// `provenance` fields, NEVER from parsing ref strings (the deliberate contrast
// with tailoring's e{n}b{m} prefix law). The gate never enumerates evidence
// KINDS (bullets vs mastery vs summaries) - kind semantics live in `owner`, so
// the M6-03 payload can add kinds without touching this module.
//
// Conservative tie-break, the gate's design law (ADR-0018 sec 7): wherever a
// deterministic comparison is ambiguous, FLAG. Over-flag routes to human review
// (safe); under-flag is the failure mode. Every sec H edge resolves this way.
//
// Untrusted-text note (sec D4): posting text never enters this module's INPUTS
// (evidence/entities/vocabulary are all profile-derived). But a claim was
// drafted by a model that read the posting, so `token` may ECHO posting-derived
// text - anything that displays or stores a violation inherits the
// untrusted-text law (escape on render, M6-04/05), and logs carry law ids +
// counts only, never claim text or tokens (the pino no-PII law).

/** The evidence owner classes. `global` evidence (e.g. a Professional Summary
 *  block) is citable only by a `summary`-section claim (L4 ownership). */
export type ClaimEvidenceOwnerKind = 'experience' | 'project' | 'global';

/** One profile-derived evidence source a claim may cite. `ref` is opaque (the
 *  M6-03 payload assigns it); `sourceText` is the verified profile prose the
 *  claim must paraphrase; `owner`/`provenance` drive the L4 structural locks. */
export interface ClaimEvidenceSource {
  ref: string;
  sourceText: string;
  owner: { kind: ClaimEvidenceOwnerKind; entityRef?: string };
  provenance: ProjectProvenance | null;
}

/** The sent entity universe (experience/project ids the payload included). An
 *  `experience`/`project` claim's entityRef must be a member (L6). */
export interface ClaimProvenanceEntities {
  experiences: string[];
  projects: string[];
}

/**
 * Gate input (the SuggestUpgradesInput idiom). Every field EXCEPT `claims` is
 * profile-derived and, at M6-04 verdict time, re-derived server-side from the DB
 * (never client-supplied): a client-chosen `evidence`/`skillVocabulary` guts
 * every law while returning ok:true - the M4-02 never-trust-the-client headline,
 * carried to M6-04 as a named obligation (sec H).
 */
export interface CheckClaimProvenanceInput {
  claims: ResumeClaimDraft[];
  evidence: ClaimEvidenceSource[];
  entities: ClaimProvenanceEntities;
  skillVocabulary: string[];
}

/** Law ids, in violation-sort order. */
export const CLAIM_PROVENANCE_LAWS = [
  'citation_membership',
  'numeric',
  'vocabulary',
  'provenance_class',
  'external_pointer',
  'shape',
] as const;
export type ClaimProvenanceLaw = (typeof CLAIM_PROVENANCE_LAWS)[number];

/** One law violation for one claim. `refs`/`token` are optional audit hints;
 *  `token` is a bounded (<=80) fragment inheriting the untrusted-text law. */
export interface ClaimProvenanceViolation {
  claimIndex: number;
  law: ClaimProvenanceLaw;
  refs?: string[];
  token?: string;
}

export type ClaimProvenanceResult =
  { ok: true } | { ok: false; violations: ClaimProvenanceViolation[] };

// ---------------------------------------------------------------------------
// L2 numeric extraction (digit-based; NO word-number, NO multiplier expansion)
// ---------------------------------------------------------------------------

export type NumericUnit = 'percent' | 'currency';

/** One numeric mention: its canonical number (thousands separators stripped,
 *  decimal points + dotted multi-parts + lowercased k/m/b suffix preserved
 *  as-written) and its unit CLASS (null when bare). */
export interface NumericMention {
  number: string;
  unit: NumericUnit | null;
}

/**
 * EXPORTED DATA, not prose (sec D3 L2): the marker<->unit mapping. The M6-03 prompt
 * ("digits-as-written") and any flag reader quote THIS const rather than
 * paraphrasing the plan - one definition, pinned by tests. `percent` is marked
 * by a trailing `%` or an adjacent word "percent"; `currency` by a leading `$`
 * or an adjacent word "dollars"/"usd". Compatible markers (`%`<->percent,
 * `$`<->dollars|usd) collapse to the same class, so `40%` and `40 percent` match.
 */
export const NUMERIC_UNIT_MARKERS: Record<
  NumericUnit,
  { prefixSymbols: readonly string[]; suffixSymbols: readonly string[]; words: readonly string[] }
> = {
  percent: { prefixSymbols: [], suffixSymbols: ['%'], words: ['percent'] },
  currency: { prefixSymbols: ['$'], suffixSymbols: [], words: ['dollars', 'usd'] },
};

// A number core: leading digit, optional thousands-comma digits, optional dotted
// multi-part groups (`1.2`, `2.0.1`). A range like `40-50` yields two cores (the
// hyphen is not part of a core), so both endpoints become mentions.
const NUMBER_CORE_SOURCE = '[0-9][0-9,]*(?:\\.[0-9]+)*';
// A k/m/b(n) multiplier suffix attached to the core - part of the number token
// (NO expansion: `1.2m` stays `1.2m`, distinct from `1200000`). The negative
// lookahead keeps it from eating a letter out of a following word (`5mb`).
const SUFFIX_RE = /^(bn|k|m|b)(?![a-z])/;

function detectUnit(before: string, after: string): NumericUnit | null {
  for (const unit of Object.keys(NUMERIC_UNIT_MARKERS) as NumericUnit[]) {
    const cfg = NUMERIC_UNIT_MARKERS[unit];
    if (cfg.suffixSymbols.some((s) => after.startsWith(s))) return unit;
    if (cfg.prefixSymbols.some((s) => before.endsWith(s))) return unit;
    for (const word of cfg.words) {
      if (new RegExp(`^\\s*${word}\\b`).test(after)) return unit;
      if (new RegExp(`\\b${word}\\s*$`).test(before)) return unit;
    }
  }
  return null;
}

/**
 * Extract every numeric mention from `text` (exported helper; digit-based). Used
 * by L2 and pinned directly by tests. Case-insensitive; deterministic.
 */
export function extractNumericMentions(text: string): NumericMention[] {
  const lower = text.toLowerCase();
  const mentions: NumericMention[] = [];
  const re = new RegExp(NUMBER_CORE_SOURCE, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    const core = m[0];
    let endIdx = m.index + core.length;
    let suffix = '';
    const suffixMatch = SUFFIX_RE.exec(lower.slice(endIdx));
    if (suffixMatch) {
      suffix = suffixMatch[1] ?? '';
      endIdx += suffix.length;
    }
    const number = core.replace(/,/g, '') + suffix;
    const unit = detectUnit(lower.slice(0, m.index), lower.slice(endIdx));
    mentions.push({ number, unit });
    re.lastIndex = endIdx; // skip past a consumed suffix
  }
  return mentions;
}

// ---------------------------------------------------------------------------
// Per-law checks (each separately testable; each yields at most one violation
// per claim so the output is one row per (claim, law))
// ---------------------------------------------------------------------------

const clamp80 = (s: string): string => (s.length > 80 ? s.slice(0, 80) : s);
const sortedUnique = (refs: string[]): string[] => [...new Set(refs)].sort();

/** L1: every citation ref exists in evidence; no duplicate ref within a claim. */
function citationMembership(
  claim: ResumeClaimDraft,
  evidenceRefs: ReadonlySet<string>,
): string[] | null {
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const ref of claim.citationRefs) {
    if (!evidenceRefs.has(ref)) bad.push(ref);
    if (seen.has(ref)) bad.push(ref);
    else seen.add(ref);
  }
  return bad.length > 0 ? sortedUnique(bad) : null;
}

/** L2: every claim number must appear in a cited source; a unit-marked mention
 *  additionally needs a compatible-marker match. Returns the first unsatisfied
 *  mention's canonical number (the audit token) or null. */
function numericBacking(claim: ResumeClaimDraft, cited: ClaimEvidenceSource[]): string | null {
  const claimMentions = extractNumericMentions(claim.text);
  if (claimMentions.length === 0) return null;
  const evidenceMentions = cited.flatMap((s) => extractNumericMentions(s.sourceText));
  for (const cm of claimMentions) {
    const satisfied =
      cm.unit === null
        ? evidenceMentions.some((em) => em.number === cm.number)
        : evidenceMentions.some((em) => em.number === cm.number && em.unit === cm.unit);
    if (!satisfied) return clamp80(cm.number);
  }
  return null;
}

/** L3: any profile skill phrase the claim asserts (phraseMatches, gap 2) must be
 *  backed by a cited source's text (same semantics). Returns the first unbacked
 *  phrase or null. Short/common skills over-flag by design (ADR-named residual). */
function vocabularyBacking(
  claim: ResumeClaimDraft,
  cited: ClaimEvidenceSource[],
  skillVocabulary: string[],
): string | null {
  for (const phrase of skillVocabulary) {
    if (textMatchesPhrase(claim.text, phrase, 2)) {
      const backed = cited.some((s) => textMatchesPhrase(s.sourceText, phrase, 2));
      if (!backed) return clamp80(phrase);
    }
  }
  return null;
}

/** L4: two independent structural locks. (i) OWNERSHIP - an experience/project
 *  claim may cite only its own entity's evidence; a summary claim may cite any.
 *  (ii) CLASS - personal / personal_ai_assisted evidence can NEVER back an
 *  experience-section claim, kept as its own assertion so a future ownership
 *  loosening cannot silently drop the "never under employment" law. */
function provenanceClass(claim: ResumeClaimDraft, cited: ClaimEvidenceSource[]): string[] | null {
  if (claim.section === 'summary') return null;
  const bad: string[] = [];
  for (const s of cited) {
    let violates = false;
    if (claim.section === 'experience') {
      // (i) ownership
      if (!(s.owner.kind === 'experience' && s.owner.entityRef === claim.entityRef))
        violates = true;
      // (ii) class - independent lock
      if (s.provenance === 'personal' || s.provenance === 'personal_ai_assisted') violates = true;
    } else {
      // project
      if (!(s.owner.kind === 'project' && s.owner.entityRef === claim.entityRef)) violates = true;
    }
    if (violates) bad.push(s.ref);
  }
  return bad.length > 0 ? sortedUnique(bad) : null;
}

/** L6 (aggregate + per-claim shape): compute the set of claim indices that carry
 *  any shape violation. entityRef-null-iff-summary; entityRef in sent entities;
 *  text <=300; summary total <=600; <=40 claims; <=6/experience; <=4/project.
 *  Aggregate breaches attribute to the specific claim that crosses the cap. */
function shapeViolatingIndices(
  claims: ResumeClaimDraft[],
  entities: ClaimProvenanceEntities,
): ReadonlySet<number> {
  const bad = new Set<number>();
  const expCounts = new Map<string, number>();
  const projCounts = new Map<string, number>();
  let summaryRunning = 0;

  claims.forEach((c, i) => {
    // entityRef null iff summary; membership in sent entities.
    if (c.section === 'summary') {
      if (c.entityRef !== null) bad.add(i);
    } else if (c.entityRef === null) {
      bad.add(i);
    } else {
      const pool = c.section === 'experience' ? entities.experiences : entities.projects;
      if (!pool.includes(c.entityRef)) bad.add(i);
    }

    if (c.text.length > RESUME_CLAIM_TEXT_MAX_CHARS) bad.add(i);
    if (i >= RESUME_MAX_CLAIMS) bad.add(i);

    // per-entity caps: the claim that pushes a group over its cap is flagged.
    if (c.section === 'experience' && c.entityRef !== null) {
      const n = (expCounts.get(c.entityRef) ?? 0) + 1;
      expCounts.set(c.entityRef, n);
      if (n > RESUME_MAX_CLAIMS_PER_EXPERIENCE) bad.add(i);
    } else if (c.section === 'project' && c.entityRef !== null) {
      const n = (projCounts.get(c.entityRef) ?? 0) + 1;
      projCounts.set(c.entityRef, n);
      if (n > RESUME_MAX_CLAIMS_PER_PROJECT) bad.add(i);
    }

    // summary total: the claim at which the running summary length crosses 600.
    if (c.section === 'summary') {
      summaryRunning += c.text.length;
      if (summaryRunning > RESUME_SUMMARY_TOTAL_MAX_CHARS) bad.add(i);
    }
  });

  return bad;
}

const lawRank = (law: ClaimProvenanceLaw): number => CLAIM_PROVENANCE_LAWS.indexOf(law);

/**
 * Check a model-drafted claim set against the six provenance laws. Pure and
 * deterministic: identical input yields deep-equal results. ANY violation ->
 * ok:false (the caller flags the run and writes nothing). Zero claims -> ok:true
 * (vacuous; whether an empty draft is acceptable is M6-04's policy).
 */
export function checkClaimProvenance(input: CheckClaimProvenanceInput): ClaimProvenanceResult {
  const { claims, evidence, entities, skillVocabulary } = input;
  const evidenceByRef = new Map<string, ClaimEvidenceSource>();
  for (const source of evidence) evidenceByRef.set(source.ref, source);
  const evidenceRefs = new Set(evidenceByRef.keys());
  const shapeBad = shapeViolatingIndices(claims, entities);

  const violations: ClaimProvenanceViolation[] = [];
  claims.forEach((claim, i) => {
    // Cited sources that actually EXIST (dangling refs are L1's job; L2-L4 verdict
    // against the resolvable cited set only).
    const cited = claim.citationRefs
      .map((ref) => evidenceByRef.get(ref))
      .filter((s): s is ClaimEvidenceSource => s !== undefined);

    const membership = citationMembership(claim, evidenceRefs);
    if (membership)
      violations.push({ claimIndex: i, law: 'citation_membership', refs: membership });

    const numericToken = numericBacking(claim, cited);
    if (numericToken !== null)
      violations.push({ claimIndex: i, law: 'numeric', token: numericToken });

    const vocabToken = vocabularyBacking(claim, cited, skillVocabulary);
    if (vocabToken !== null)
      violations.push({ claimIndex: i, law: 'vocabulary', token: vocabToken });

    const provRefs = provenanceClass(claim, cited);
    if (provRefs) violations.push({ claimIndex: i, law: 'provenance_class', refs: provRefs });

    if (containsExternalPointer(claim.text))
      violations.push({ claimIndex: i, law: 'external_pointer' });

    if (shapeBad.has(i)) violations.push({ claimIndex: i, law: 'shape' });
  });

  violations.sort((a, b) => a.claimIndex - b.claimIndex || lawRank(a.law) - lawRank(b.law));
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
