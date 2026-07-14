// Provider Load Balancer (Master Prompt Part 6.5).
//
// Provider Router (config.ts resolveRole* / dars/select.ts) already decides
// WHICH provider serves a call. This decides WHICH INSTANCE of that provider
// serves it, when more than one exists. Cloud vendors (Gemini/DeepSeek/Qwen/
// Llama/Anthropic/OpenRouter) are single logical endpoints the vendor already
// load-balances server-side — they only ever have one instance here, so
// picking among them is a no-op. Local models (Ollama/vLLM) are the real case:
// an operator can point at several self-hosted endpoints via a comma-separated
// base-URL env var (OLLAMA_BASE_URL=http://host1:11434/v1,http://host2:...),
// and this picks the best one per call.
//
// Every call's real observed latency (providers/client.ts) feeds back into the
// same pool used for the next pick — this is genuinely adaptive, not a fixed
// round-robin pretending to be smart.

export type LBStrategy = 'round-robin' | 'least-latency';

interface InstanceHealth {
  ewmaLatencyMs: number;
  inFlight: number;
}

const INIT_LATENCY_MS = 500;

/** Rate Limit Protection (Master Prompt 6.5): a soft cap on concurrent
 *  requests per instance, proactive rather than DARS's reactive 429 circuit
 *  breaking (dars/health.ts) — this tries to avoid TRIGGERING a rate limit in
 *  the first place by spreading load, instead of only recovering after one
 *  happens. Soft, not a hard queue/block: with everything at capacity, the
 *  least-loaded instance still gets picked rather than the caller stalling —
 *  a stall here has no relief valve (no other component would free a slot),
 *  so degrading gracefully beats introducing a new deadlock risk. */
function defaultMaxConcurrentPerInstance(): number {
  const n = Number(process.env.LB_MAX_CONCURRENT_PER_INSTANCE);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 10;
}

export class InstancePool {
  private health = new Map<string, InstanceHealth>();
  private rrCounters = new Map<string, number>();

  constructor(private readonly maxConcurrentPerInstance: number = defaultMaxConcurrentPerInstance()) {}

  private entry(url: string): InstanceHealth {
    let h = this.health.get(url);
    if (!h) {
      h = { ewmaLatencyMs: INIT_LATENCY_MS, inFlight: 0 };
      this.health.set(url, h);
    }
    return h;
  }

  /** Pick one base URL from a candidate list. Single-instance providers (the
   *  common case) short-circuit — no tracking overhead, no strategy needed. */
  pick(instances: string[], strategy: LBStrategy = 'least-latency'): string {
    if (instances.length === 1) return instances[0];
    if (!instances.length) throw new Error('InstancePool.pick: no instances given');

    // Prefer instances under the concurrency cap; only consider saturated
    // ones if every instance is at/over it (graceful degradation, not a block).
    const underCap = instances.filter((url) => this.entry(url).inFlight < this.maxConcurrentPerInstance);
    const pool = underCap.length ? underCap : instances;

    if (strategy === 'round-robin') {
      const key = pool.join('|');
      const i = (this.rrCounters.get(key) ?? 0) % pool.length;
      this.rrCounters.set(key, i + 1);
      return pool[i];
    }

    // least-latency, tie-broken by fewest requests currently in flight.
    return pool
      .map((url) => ({ url, h: this.entry(url) }))
      .sort((a, b) => a.h.ewmaLatencyMs - b.h.ewmaLatencyMs || a.h.inFlight - b.h.inFlight)[0].url;
  }

  recordStart(url: string): void {
    this.entry(url).inFlight++;
  }

  recordEnd(url: string, latencyMs: number): void {
    const h = this.entry(url);
    h.inFlight = Math.max(0, h.inFlight - 1);
    h.ewmaLatencyMs = 0.7 * h.ewmaLatencyMs + 0.3 * latencyMs;
  }

  snapshot(): Array<{ url: string } & InstanceHealth> {
    return [...this.health.entries()].map(([url, h]) => ({ url, ...h }));
  }
}

/** Parse a comma-separated base-URL env value into a deduplicated instance
 *  list, falling back to the provider's single default URL when unset. */
export function parseInstanceUrls(raw: string | undefined, fallback: string): string[] {
  if (!raw || !raw.trim()) return [fallback];
  const urls = raw.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  return urls.length ? [...new Set(urls)] : [fallback];
}

export const globalInstancePool = new InstancePool();
