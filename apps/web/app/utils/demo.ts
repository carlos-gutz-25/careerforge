/**
 * The canonical PUBLISHED demo credentials (M10-04, D3). This is the single
 * source the whole demo arc reuses: the login page prefills these when the
 * instance reports demo mode, the M10-06 deploy runbook sets
 * AUTH_BOOTSTRAP_EMAIL/PASSWORD to exactly these, and the M10-08 smoke logs in
 * with them. Drift between web and runbook is caught at that smoke.
 *
 * These are DELIBERATELY PUBLISHED, not a leak: the email uses the RFC 2606
 * reserved `.example` TLD (structurally fictional, never routable) and the
 * password is an obviously non-secret passphrase. They gate a fictional-data
 * instance that resets nightly. The throwaway-creds smoke law still governs
 * real smokes; this pair is the advertised public demo login by design.
 */
export const DEMO_EMAIL = 'demo@careerforge.example';
export const DEMO_PASSWORD = 'explore-the-demo-2026';

/**
 * The persistent demo banner copy (D2), single-sourced so the two mount points
 * (the layout shell and the layout-opted-out login page) never drift. Honest
 * and no em-dashes (Carlos-voice published-content law): every claim here is
 * exactly what the m10-03 seed produces (fictional profile, nightly reset,
 * keyless demo whose drafted artifacts were pre-generated).
 */
export const DEMO_BANNER_TEXT =
  'Public demo. All data here is fictional and resets nightly. AI drafting is disabled in the demo; drafted artifacts shown were pre-generated from this fictional profile.';
