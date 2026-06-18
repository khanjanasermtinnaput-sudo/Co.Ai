// DARS — per-provider health store + circuit breaker (TDD §4.3).
// MVP: in-memory Map (persists across requests on a warm Vercel instance).
// At scale this interface is backed by Redis so health is shared across instances.

import type { FailureKind } from './classify.js';

type Circuit = 'closed' | 'open' | 'half_open';

export interface ProviderHealth {
  key: string;             // health unit: 'gemini' | 'openrouter:gemini' | ...
  circuit: Circuit;
  consecutiveFails: number;
  ewmaLatencyMs: number;   // exponential moving average of latency
  successRate: number;     // EWMA of success(1)/fail(0), 0..1
  cooldownUntil?: number;  // epoch ms (rate_limit / quota / open backoff)
  lastKind?: FailureKind;
  lastError?: string;
  updatedAt: number;
}

const FAIL_THRESHOLD = 3;          // consecutive transient fails → open
const BASE_COOLDOWN_MS = 30_000;   // base open cooldown
const QUOTA_COOLDOWN_MS = 60 * 60_000;  // quota exhausted → back off 1h
const RATE_COOLDOWN_MS = 60_000;        // default rate-limit cooldown if no Retry-After
const AUTH_COOLDOWN_MS  = 24 * 60 * 60_000; // bad API key → back off 24h (permanent until key changes)
const INIT_LATENCY = 1500;

export class HealthStore {
  private map = new Map<string, ProviderHealth>();

  get(key: string): ProviderHealth {
    let h = this.map.get(key);
    if (!h) {
      h = {
        key, circuit: 'closed', consecutiveFails: 0,
        ewmaLatencyMs: INIT_LATENCY, successRate: 1, updatedAt: Date.now(),
      };
      this.map.set(key, h);
    }
    return h;
  }

  /** Available to take traffic now? (closed, or open past cooldown → half-open probe). */
  isAvailable(key: string): boolean {
    const h = this.get(key);
    if (h.circuit === 'closed') return true;
    if (h.circuit === 'open') {
      if (Date.now() >= (h.cooldownUntil ?? 0)) {
        h.circuit = 'half_open'; // allow a single probe
        return true;
      }
      return false;
    }
    return true; // half_open → probe allowed
  }

  recordSuccess(key: string, latencyMs: number): void {
    const h = this.get(key);
    h.consecutiveFails = 0;
    h.circuit = 'closed';
    h.cooldownUntil = undefined;
    h.ewmaLatencyMs = 0.7 * h.ewmaLatencyMs + 0.3 * latencyMs;
    h.successRate = 0.8 * h.successRate + 0.2 * 1;
    h.updatedAt = Date.now();
  }

  recordFailure(key: string, kind: FailureKind, retryAfterMs?: number): void {
    const h = this.get(key);
    h.consecutiveFails += 1;
    h.successRate = 0.8 * h.successRate + 0.2 * 0;
    h.lastKind = kind;
    h.updatedAt = Date.now();

    if (kind === 'auth') {
      // Invalid API key is permanent until the key is changed — open for 24h to
      // avoid wasting calls retrying a provider that will always reject us.
      h.circuit = 'open';
      h.cooldownUntil = Date.now() + AUTH_COOLDOWN_MS;
    } else if (kind === 'quota') {
      h.circuit = 'open';
      h.cooldownUntil = Date.now() + (retryAfterMs ?? QUOTA_COOLDOWN_MS);
    } else if (kind === 'rate_limit') {
      h.circuit = 'open';
      h.cooldownUntil = Date.now() + (retryAfterMs ?? RATE_COOLDOWN_MS);
    } else if (kind === 'low_quality') {
      // Repeated low-quality results indicate the provider is unhealthy; let them
      // accumulate toward the circuit-open threshold like other failures do.
      if (h.consecutiveFails >= FAIL_THRESHOLD) {
        const factor = Math.min(h.consecutiveFails - FAIL_THRESHOLD, 4);
        h.circuit = 'open';
        h.cooldownUntil = Date.now() + BASE_COOLDOWN_MS * 2 ** factor;
      }
    } else if (h.consecutiveFails >= FAIL_THRESHOLD) {
      // exponential backoff for repeated down/timeout
      const factor = Math.min(h.consecutiveFails - FAIL_THRESHOLD, 4);
      h.circuit = 'open';
      h.cooldownUntil = Date.now() + BASE_COOLDOWN_MS * 2 ** factor;
    }
  }

  snapshot(): ProviderHealth[] {
    return [...this.map.values()];
  }
}

// Module-level singleton — shared across requests on a warm instance.
export const globalHealth = new HealthStore();
