/**
 * Shared environment-gate helper — content-quality assertions that depend on
 * a live LLM response must not fail just because the provider/rate-limiter
 * returned a transient error instead of real content. Pass either an HTTP
 * status or an error string (e.g. "HTTP 429").
 */
export function isEnvironmentGate(input: number | string | undefined | null): boolean {
  if (input === undefined || input === null) return false;
  const s = String(input);
  return /\b(401|403|429|502|503)\b/.test(s);
}
