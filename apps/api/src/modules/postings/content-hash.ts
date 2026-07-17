import { createHash } from 'node:crypto';

import { normalizeWhitespace } from '@careerforge/core';

// Dedupe hashing for pasted posting text (M1-01). The whitespace normalization
// was hoisted to @careerforge/core at M1-06 (quote verification became its
// second consumer — the two MUST share semantics); the sha256 step stays here
// because node:crypto must stay out of the browser-consumed core package.

/** SHA-256 hex over the UTF-8 bytes of the whitespace-normalized text — the
 *  stored raw_text stays verbatim as pasted. Re-pastes of the same posting
 *  routinely differ in line endings and trailing whitespace (copy mechanics);
 *  whitespace-identical texts are the same posting. */
export function postingContentHash(rawText: string): string {
  return createHash('sha256').update(normalizeWhitespace(rawText), 'utf8').digest('hex');
}
