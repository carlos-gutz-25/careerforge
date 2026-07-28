// Pure text utilities — this package is browser-consumed, so nothing here may
// import node:crypto or any other Node builtin (the sha256 posting hash stays
// in apps/api and imports the normalizer from here; hoisted from
// apps/api/src/modules/postings/content-hash.ts per the M1-01 ledger, executed
// at M1-06 when quote verification became the second consumer).

/**
 * Whitespace normalization shared by the posting content hash (M1-01) and
 * quote verification (M1-06): collapse every whitespace run to a single space,
 * trim the ends. Stored text stays verbatim — this is a comparison view only.
 * `\s` covers Unicode space separators (NBSP U+00A0, U+2000–200A, U+202F,
 * U+3000, U+FEFF, line/paragraph separators), so those collapse too; zero-width
 * characters (U+200B, U+2060) are NOT `\s` and survive normalization. No
 * Unicode normalization (NFC/NFD) — parked until a real false/missed match
 * involves visually-identical text.
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Evidence verification (ADR-0006 layer 4, the tripwire): each quote must be
 * a verbatim, whitespace-normalized substring of the source text. Deterministic
 * string matching — zero LLM involvement. Case-sensitive by contract: the
 * extraction prompt demands quotes "character-for-character with original
 * casing", and folding would let a manufactured near-quote pass.
 *
 * A quote that is EMPTY after normalization is false: `''.includes('')` is
 * vacuously true, and a quote that says nothing verifies nothing.
 *
 * Documented residuals (flags mean human review, not data loss):
 * - Typographic substitution — straight `'` where the posting has curly `’`,
 *   hyphen for em-dash — flags. This is the likeliest legitimate flag source
 *   and is deliberate: "verbatim means verbatim".
 * - Case-only differences flag, same rationale.
 * - Zero-width characters present on one side only flag (invisible-character
 *   divergence is unicode-smuggling-adjacent — a desirable catch).
 */
export function verifyQuotes(sourceText: string, quotes: readonly string[]): boolean[] {
  const normalizedSource = normalizeWhitespace(sourceText);
  return quotes.map((quote) => {
    const normalizedQuote = normalizeWhitespace(quote);
    if (normalizedQuote === '') return false;
    return normalizedSource.includes(normalizedQuote);
  });
}

/**
 * MATCHING normalization (M1-09, plan amendment A5) — a separate function by
 * design: `normalizeWhitespace`/`verifyQuotes` are an ADR-0006 security
 * contract (case-sensitive, punctuation-preserving — "verbatim means
 * verbatim") and must never loosen. This one exists for the opposite job:
 * deterministic VOCABULARY matching in the fit engine, where `node_js` must
 * meet "Node.js". Lowercase, punctuation and underscores become spaces,
 * whitespace collapses. Never used for evidence verification.
 */
export function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** `normalizeForMatching`, split to tokens; '' yields no tokens (never ['']). */
export function tokenizeForMatching(text: string): string[] {
  const normalized = normalizeForMatching(text);
  return normalized === '' ? [] : normalized.split(' ');
}

// Public TLDs the bare-domain probe recognizes. Deliberately a small common set,
// not the full IANA list: the job is to catch a model pointing off-platform in
// prose, not to validate every domain. Widening it is a one-line change with a
// test row. `.js`/`.ts`/`.tsx` etc. are intentionally ABSENT so `Node.js`,
// `index.ts` and friends never read as domains.
const EXTERNAL_POINTER_TLDS = [
  'com',
  'org',
  'net',
  'io',
  'dev',
  'app',
  'edu',
  'gov',
  'co',
  'ai',
  'xyz',
  'tech',
  'info',
  'biz',
] as const;

// Dotted TECH NAMES that end in a real TLD and must NOT flag (test-pinned,
// ADR-0017). The `.js` family (`Node.js`, `React.js`, ...) is handled for free -
// `js` is not a TLD - but these two collide with `.io`/`.net` and are pinned out
// explicitly. Adding a colliding name is a one-line addition here plus a test.
const TECH_NAME_NEGATIVES = new Set(['socket.io', 'asp.net']);

const URL_SCHEME_RE = /(?:https?|ftp):\/\//i; // http:// https:// ftp://
const CONTACT_SCHEME_RE = /\b(?:mailto|tel):\S/i; // mailto:foo tel:+1...
const WWW_RE = /\bwww\.[a-z0-9-]/i; // www.<host>
const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}\b/i; // name@host.tld
// Bare domain: one or more `label.` groups followed by a recognized TLD. The
// mandatory literal dot between labels anchors each repetition, so the nested
// quantifier cannot backtrack pathologically (no ReDoS).
const DOMAIN_RE = new RegExp(
  String.raw`\b(?:[a-z0-9-]+\.)+(?:${EXTERNAL_POINTER_TLDS.join('|')})\b`,
  'gi',
);

/**
 * External-pointer tripwire (ADR-0017, the no-URL law). A URL, email, or bare
 * domain emitted by the LLM inside a recommendation is an UNVERIFIABLE citation:
 * the model cannot know a link is live, correct, or safe, and a drafted pointer
 * is exactly the "send the user off-platform / resemble an application" surface
 * the honesty contract forbids (RISKS H-01). This deterministic guard lets the
 * drafting tripwire flag the run and write nothing when the model points out.
 * Pure and browser-safe - zero LLM involvement, no Node builtins.
 *
 * Returns true on any of:
 * - a URL scheme (`http://`, `https://`, `ftp://`);
 * - a contact scheme (`mailto:`, `tel:`);
 * - a `www.` host prefix;
 * - an email address (`name@host.tld`);
 * - a bare domain (`label.tld`, `sub.label.tld`) whose final label is a known
 *   public TLD (EXTERNAL_POINTER_TLDS).
 *
 * Deliberate negatives - dotted TECH NAMES are not pointers and must never flag
 * (test-pinned): the `.js` family (`Node.js`, `React.js`, `Vue.js`, `Next.js`,
 * `Express.js`, `Chart.js`, `Three.js`, `D3.js`) never matches because `js` is
 * not a TLD; `socket.io` and `asp.net` DO end in a real TLD and are pinned out
 * in TECH_NAME_NEGATIVES. Version numbers (`v2.0.1`) and abbreviations (`e.g.`,
 * `U.S.`) never match - their trailing label is not a TLD.
 *
 * Documented residual (a flag means human review, not silent loss): a genuine
 * product name ending in a public TLD that is not yet pinned (a new `foo.io`
 * library) will flag - a conservative, honest over-flag. The fix is to pin it,
 * never to loosen the TLD set. Case-insensitive throughout.
 */
export function containsExternalPointer(text: string): boolean {
  if (
    URL_SCHEME_RE.test(text) ||
    CONTACT_SCHEME_RE.test(text) ||
    WWW_RE.test(text) ||
    EMAIL_RE.test(text)
  ) {
    return true;
  }
  // Any bare domain that is not a pinned tech-name negative is a pointer.
  const domains = text.match(DOMAIN_RE);
  if (domains === null) return false;
  return domains.some((domain) => !TECH_NAME_NEGATIVES.has(domain.toLowerCase()));
}

// Line-anchored outreach markers (ADR-0019 layer L3). Each operates on a single
// trimmed line (looksLikeOutreach splits on \n first), so a greeting word or
// closing word appearing MID-SENTENCE never flags — only a line that OPENS as a
// salutation or STANDS ALONE as a sign-off. All are dot-anchored/bounded with no
// nested quantifiers over unbounded runs, so they are ReDoS-safe by construction
// (the containsExternalPointer discipline).
//
// Salutation: a greeting that opens the line and ends the line in `,`/`:` — the
// letter-opening shape (`Dear Hiring Manager,` / `Hi Jane:`). The `[^\n]*`
// cannot backtrack pathologically: it runs over a single already-split line and
// is pinned on both ends.
const SALUTATION_RE = /^(?:Dear|Hi|Hello|Hey|Greetings)\b[^\n]*[,:]$/i;
// The set-phrase salutation that carries no trailing name (matched on its own).
const TO_WHOM_RE = /^to whom it may concern\b/i;
// Sign-off: a closing that stands alone on its line, optional trailing comma
// (`Sincerely,` / `Best regards`).
const SIGNOFF_RE =
  /^(?:Sincerely|Regards|Best regards|Best|Kind regards|Warm regards|Thanks|Thank you|Cheers|Yours truly|Respectfully),?$/i;
// A `Subject:` header line (email/letter shape).
const SUBJECT_RE = /^Subject\s*:/i;

/**
 * Message-likeness tripwire (ADR-0019, layer L3 of the never-send defense). A
 * gameplan is coaching about HOW to pursue a posting — strategy and reflection —
 * and must never become a drafted, sendable outreach message (a cover letter, a
 * recruiter email, a LinkedIn note). This deterministic guard returns true when
 * `text` carries LINE-ANCHORED outreach STRUCTURE, so the M7-07 server tripwire
 * can flag the run and write nothing (flag-the-run-write-nothing). It is the
 * message-shaped sibling of `containsExternalPointer` — "one contract per job"
 * (ADR-0017): a distinct FUNCTION for a distinct hazard, sharing the low-level
 * `EMAIL_RE` primitive rather than re-declaring it. Pure and browser-safe — zero
 * LLM involvement, no Node builtins.
 *
 * Returns true on any of (each matched per-line after splitting on `\n`):
 * - a SALUTATION line: a greeting (`Dear`/`Hi`/`Hello`/`Hey`/`Greetings`) that
 *   opens the line and ends it in `,`/`:`, plus the `To whom it may concern` idiom;
 * - a SIGN-OFF line: a closing (`Sincerely`/`Regards`/`Best`/`Thanks`/`Cheers`/…)
 *   standing alone on its line;
 * - a `Subject:` header line;
 * - an embedded EMAIL address anywhere (reuses `EMAIL_RE`).
 *
 * Deliberate negatives (test-pinned): greeting/closing WORDS mid-sentence never
 * flag — `Hi there, welcome` inside a paragraph, `the best approach is…`, `thank
 * the interviewer` as advice — only line-anchored openers/closers do. The empty
 * string is not outreach.
 *
 * Documented residual (a flag means human review, not silent loss; ADR-0019): the
 * COMMISSION-ONLY residual — outreach-shaped PROSE that carries none of these
 * structural markers (a paragraph reading like a cover letter but opening with no
 * salutation line) is caught only by human review under draft-until-reviewed, and
 * by layer L1 (the schema holds no message field). The guard is deliberately
 * conservative and over-flags to review rather than passing silently.
 */
export function looksLikeOutreach(text: string): boolean {
  if (EMAIL_RE.test(text)) return true;
  return text.split(/\n/).some((rawLine) => {
    const line = rawLine.trim();
    if (line === '') return false;
    return (
      SALUTATION_RE.test(line) ||
      TO_WHOM_RE.test(line) ||
      SIGNOFF_RE.test(line) ||
      SUBJECT_RE.test(line)
    );
  });
}
