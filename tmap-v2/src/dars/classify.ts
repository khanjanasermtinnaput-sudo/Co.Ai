// DARS — failure classification (TDD §4.2).
// Maps an Error thrown by providers/client.ts `chat()` into a failure kind so the
// resilience layer can decide: retry, failover, or cool the provider down.

export type FailureKind =
  | 'down'         // network / DNS / 5xx — provider unreachable
  | 'timeout'      // exceeded PER_CALL_TIMEOUT (AbortController)
  | 'rate_limit'   // HTTP 429
  | 'quota'        // 402/403 billing / quota exhausted
  | 'high_latency' // slow but succeeded (recorded separately)
  | 'low_quality'; // empty / unparseable / failed quality gate

export function classifyError(e: Error): FailureKind {
  const m = (e.message || '').toLowerCase();

  if (m.includes('abort') || m.includes('timeout') || m.includes('timed out')) return 'timeout';
  if (m.includes('429') || m.includes('rate limit') || m.includes('too many requests')) return 'rate_limit';
  if (
    m.includes('quota') || m.includes('insufficient') || m.includes('billing') ||
    m.includes('payment') || m.includes(' 402') || m.includes('http 402') || m.includes(' 403') || m.includes('http 403')
  ) return 'quota';
  if (m.includes('empty response')) return 'low_quality';
  if (
    m.includes('network error') || m.includes('fetch failed') || m.includes('econn') ||
    m.includes('enotfound') || m.includes('socket') || /http 5\d\d/.test(m)
  ) return 'down';

  // Unknown 4xx or other → treat as down (failover, but no long cooldown)
  return 'down';
}

/** Parse a Retry-After hint (seconds) if the provider embedded it in the message. */
export function retryAfterMs(e: Error): number | undefined {
  const m = (e.message || '');
  const sec = m.match(/retry[- ]after[":\s]*([0-9]+)/i);
  if (sec) return Number(sec[1]) * 1000;
  return undefined;
}
