import { ApiError } from './api-error.ts';

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

/**
 * The DEMO_DISABLED error code (M10-04, D4). m10-03's demo hook returns this
 * 403 code on the eight LLM-draft POSTs; apps/web disables those trigger
 * buttons up front, and this is the belt if a call still fires. Bound to the
 * merged api shape (apps/api/src/modules/demo/demo.hooks.ts).
 */
export const DEMO_DISABLED_CODE = 'DEMO_DISABLED';

/**
 * Short inline note shown beside a disabled draft trigger in demo mode. The
 * banner carries the full explanation; this is just the local "why". Also the
 * user-facing message the belt maps a DEMO_DISABLED 403 to (never the raw
 * server text). Honest, no em-dashes.
 */
export const DEMO_DISABLED_NOTE =
  'Disabled in the demo. The drafts shown were pre-generated from the fictional profile.';

/**
 * Short pill label shown beside each disabled draft trigger (AppStateChip info
 * variant). The banner carries the full "why"; this is the point-of-action
 * reminder. Single-sourced so the eight surfaces stay identical.
 */
export const DEMO_DISABLED_CHIP = 'Disabled in the demo';

/**
 * The web's FIRST error-CODE branch (D4), kept here so the DEMO_DISABLED
 * mapping is not copy-pasted across the eight draft surfaces. Preserves the
 * pre-existing behavior (an ApiError surfaces its own message; anything else
 * uses the caller's fallback) and adds exactly one interception: a
 * DEMO_DISABLED 403 maps to the honest demo note, never the raw server message.
 */
export function demoAwareErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) {
    return cause.code === DEMO_DISABLED_CODE ? DEMO_DISABLED_NOTE : cause.message;
  }
  return fallback;
}
