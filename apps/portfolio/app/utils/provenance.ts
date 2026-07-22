// Provenance storage tokens → their display labels (ARCHITECTURE.md:317; RISKS
// H-01/L-02). The three tokens are the ONLY valid values — enforced at build
// time by scripts/validate-case-studies.mjs (R2), not here.
export const PROVENANCE_LABELS = {
  professional: 'Professional',
  personal: 'Personal',
  personal_ai_assisted: 'Personal, AI-assisted',
} as const;

export type ProvenanceToken = keyof typeof PROVENANCE_LABELS;

// Map a token to its display label. A token that somehow slips the gate renders
// VISIBLY as its raw value (`?? t` passthrough) rather than silently vanishing —
// a wrong label is noticeable in review; a missing one is not.
export function provenanceLabel(token: string | undefined | null): string {
  if (!token) return '';
  return PROVENANCE_LABELS[token as ProvenanceToken] ?? token;
}
