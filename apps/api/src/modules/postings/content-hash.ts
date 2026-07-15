import { createHash } from 'node:crypto';

// Dedupe hashing for pasted posting text (M1-01). Lives in apps/api, not
// packages/core: core is consumed by the browser app and node:crypto must
// stay out of it. Hoist to a shared home when M1-05 (extraction cache by
// content_hash × prompt_id) or M1-06 (quote verification) needs it.

/**
 * Whitespace normalization for hashing ONLY — the stored raw_text stays
 * verbatim as pasted. Re-pastes of the same posting routinely differ in line
 * endings and trailing whitespace (copy mechanics); whitespace-identical
 * texts are the same posting, so collapsing runs cannot merge genuinely
 * different content. Matches the whitespace-normalized matching M1-06 will
 * use for quote verification. No Unicode normalization (NFC/NFD) — parked
 * until a real false/missed duplicate involves visually-identical text.
 */
export function normalizeForHash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** SHA-256 hex over the UTF-8 bytes of the normalized text. */
export function postingContentHash(rawText: string): string {
  return createHash('sha256').update(normalizeForHash(rawText), 'utf8').digest('hex');
}
