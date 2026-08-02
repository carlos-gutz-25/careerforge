/**
 * Liveness/health wire type (M10-03 shipped the route; M10-04 adds the web
 * consumer). apps/api/src/routes/health.ts is the ENFORCED contract: its
 * inline zod response schema (`{ status: 'ok', version: string, demo: boolean }`)
 * is what the wire actually validates. This type MIRRORS that landed shape so
 * apps/web's typed client can read `/health` without re-declaring it inline
 * (use-api types come from @careerforge/core only). It is intentionally a
 * type, not a parallel zod schema: the API validates at its boundary, the SPA
 * re-parses nothing, and a second validator here would just be drift bait. The
 * `demo` flag distinguishes a public demo instance from a real one (ADR-0007);
 * apps/web uses it for the demo banner and login prefill, never for policy
 * (the server enforces demo policy via its m10-03 hooks).
 */
export type HealthResponse = {
  status: 'ok';
  version: string;
  demo: boolean;
};
