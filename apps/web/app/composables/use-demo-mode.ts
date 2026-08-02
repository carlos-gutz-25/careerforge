/**
 * Client-side demo-instance flag (M10-04). Mirrors useSessionUser's shape: one
 * useState key, resolved once per app load from the public GET /health `demo`
 * field (m10-03) by the global middleware, alongside the session resolve.
 *
 * FAIL-QUIET by design: the demo banner and login credential prefill are
 * AFFORDANCES, not policy. The SERVER enforces demo policy (m10-03's
 * DEMO_DISABLED hooks, rate limit, keyless boot), so if the health fetch fails
 * we default to `false` (no banner, no prefill) with no retry loop and no
 * console noise. A missed flag degrades the honesty of the presentation, never
 * safety. `undefined` means "not asked yet" (falsy for v-if/:disabled); `true`
 * and `false` are the resolved answers.
 */
export function useDemoState() {
  return useState<boolean | undefined>('demo-mode', () => undefined);
}

export function useDemoMode() {
  const demo = useDemoState();
  const api = useApi();

  async function resolve(): Promise<void> {
    if (demo.value !== undefined) return;
    try {
      const health = await api.health();
      demo.value = health.demo;
    } catch {
      demo.value = false;
    }
  }

  return { demo, resolve };
}
