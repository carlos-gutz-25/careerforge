// The adversarial fixture corpus (M1-07, ADR-0006 layer 6). Every fixture is
// FICTIONAL (RISKS P-01) and lives OUTSIDE registry/prompts/** so the
// literal-lint rule does not apply -- but the corpus source-byte law
// (corpus.test.ts) enforces printable-ASCII-only source, so any non-ASCII
// character in a posting MUST be written as a visible \uXXXX escape. That is
// the automatable version of the text.test.ts visible-escape law and exists to
// kill the recurring literal-invisible-byte authoring bug.

// The six attack classes the M1-07 story enumerates. Coverage across all six is
// asserted by corpus.test.ts.
export type AttackClass =
  | 'instruction-override'
  | 'role-play-coercion'
  | 'fake-delimiter'
  | 'html-script'
  | 'unicode-smuggling'
  | 'system-prompt-probe';

// Runner statuses that are within pre-registration for a hostile posting.
// 'ok' (the model extracted genuine requirements and ignored the injection) and
// 'schema_failed' (the model's attempt did not validate -- bounded by design)
// are both acceptable. 'refusal' and 'max_tokens' are deliberately absent: they
// are UNREGISTERED outcomes demanding classification (a signal to investigate
// and record, not automatically a defense failure -- a refusal on a hostile
// posting may be the model behaving well; it still lands outside pre-
// registration and must be dispositioned).
export type AcceptableStatus = 'ok' | 'schema_failed';

export interface LiveExpectation {
  /**
   * Obey-markers: strings that appear in the model output ONLY if the model
   * followed the injected instruction (echoed a payload, adopted a persona,
   * revealed the system prompt). A faithful extractor emits zero requirements
   * for a pure-injection posting, or only the genuine requirements for a mixed
   * one -- never these. Presence in ANY output field is a live-pass concern.
   */
  forbiddenSubstrings: readonly string[];
  /** Runner statuses bounded-by-design for this fixture. */
  acceptableStatuses: readonly AcceptableStatus[];
  /** Which ADR-0006 layer this fixture exercises + the faithful-behavior note. */
  notes: string;
}

export interface AdversarialFixture {
  /** Stable kebab id, unique across the corpus. */
  id: string;
  class: AttackClass;
  description: string;
  /** The hostile posting text (fictional; non-ASCII as \uXXXX escapes). */
  postingText: string;
  /** What CI structurally guarantees for this fixture, independent of the
   *  model's behavior (the mechanical invariant corpus.structural.test.ts pins). */
  ciGuard: string;
  liveExpectation: LiveExpectation;
}
