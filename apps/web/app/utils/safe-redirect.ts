/**
 * Post-login navigation targets from `?redirect=` are attacker-influenceable
 * the moment this app is hosted (someone can mail a crafted login link), so
 * they are validated like the server validates Origin: only an internal path
 * — starts with exactly one `/`, no scheme, no `//host` protocol-relative
 * form — is honored; anything else falls back to `/`. (M0-10 approval
 * amendment: open-redirect is the textbook phishing primitive.)
 */
export function safeRedirect(target: unknown): string {
  if (typeof target !== 'string') return '/';
  if (!target.startsWith('/')) return '/';
  if (target.startsWith('//')) return '/';
  return target;
}
