// Content-hash pin per shipped prompt version — the edit-in-place tripwire.
// The registry test recomputes each version's hash and compares it here:
// editing a shipped version fails the suite; shipping new behavior means a
// NEW version file plus a new pin line (deliberate, reviewable). Never
// regenerate a pin for an existing id — that is the law being bypassed
// (CLAUDE.md: new prompt behavior = new version, never edit-in-place).
export const PROMPT_PINS: Readonly<Record<string, string>> = {
  'fixture-echo@v1': 'ce96fb5dc9dea42b09d54cd64c7659481bc47bd1b3dedb6454454fe82d7b6535',
  'extract-requirements@v1': '606f8605fcbbd21a638ea6f5c4a465c77252ee09ad6237b669f40020588fbb3f',
};
