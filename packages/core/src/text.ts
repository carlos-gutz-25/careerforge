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
