import { createHash } from 'node:crypto';

import { type SourceFile } from './profile-parser.ts';

// M13-09 (F-7): the CAS token for the import deletion guard. A destructive
// import previews the would-be deletes, the operator confirms, then execution
// recomputes this digest and REJECTS if it moved - proving the source files did
// not change between preview and confirm (the PR#11 check-then-act lesson applied
// to file bytes). The digest is module-local (arc REQUIRED-2: not packages/core).
//
// It is a HASH: value-free by construction (RISKS P-01) - it can travel on the
// wire and sit in logs without exposing a byte of profile content.

/** The exact source bytes an import will consume. `facts` is null when facts.md
 *  is absent (M12-03: optional) - encoded distinctly from an empty file. */
export interface FingerprintSources {
  resume: SourceFile;
  skills: SourceFile;
  projects: SourceFile;
  criteria: SourceFile;
  facts: SourceFile | null;
}

// Fixed logical order + name - the digest is over positions, not filesystem
// paths, so it is stable across checkouts.
const ORDER: readonly (keyof FingerprintSources)[] = [
  'resume',
  'skills',
  'projects',
  'criteria',
  'facts',
];

/**
 * Deterministic sha256 over a canonical, length-prefixed encoding of the source
 * files: for each in fixed order, `name:byteLength:` followed by exactly that
 * many utf8 content bytes (absent facts.md -> `facts:absent:`, distinct from an
 * empty `facts:0:`). Length-prefix framing is self-delimiting, so no separator
 * byte is needed - and NONE is used (the source-byte law: no raw NUL/C0 in
 * source; the boundary is the length, not a control character).
 */
export function computeSourceFingerprint(sources: FingerprintSources): string {
  const hash = createHash('sha256');
  for (const name of ORDER) {
    const file = sources[name];
    if (file === null) {
      hash.update(`${name}:absent:`);
      continue;
    }
    const bytes = Buffer.from(file.content, 'utf8');
    hash.update(`${name}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}
