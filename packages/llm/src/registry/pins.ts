// Content-hash pin per shipped prompt version — the edit-in-place tripwire.
// The registry test recomputes each version's hash and compares it here:
// editing a shipped version fails the suite; shipping new behavior means a
// NEW version file plus a new pin line (deliberate, reviewable). Never
// regenerate a pin for an existing id — that is the law being bypassed
// (CLAUDE.md: new prompt behavior = new version, never edit-in-place).
export const PROMPT_PINS: Readonly<Record<string, string>> = {
  'fixture-echo@v1': 'ce96fb5dc9dea42b09d54cd64c7659481bc47bd1b3dedb6454454fe82d7b6535',
  'extract-requirements@v1': '606f8605fcbbd21a638ea6f5c4a465c77252ee09ad6237b669f40020588fbb3f',
  'improvement-plan@v1': 'b96c3a30feac5a44fac6c0ecf6a000059663a6e9b03428ef4f35bd30e4391f28',
  'learning-plan@v1': '6db9c4bcceb19eb489bc9a8510a1e2b01d35b1623b2b626e7000d440d3126017',
  'resume-tailoring@v1': '6e049d9f434bd2c71663bf6997a22d2999be2fc6bc284bf9c36bd991b3503cb4',
  'resume-tailoring@v2': '3246fdb49f048d76be1749762c6afc7a2cadeaedaa704f9eb539349f3a695ae9',
};
