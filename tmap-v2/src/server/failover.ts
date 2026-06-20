// Failover planning — circuit breaker per dependency, health-score tracking,
// retry with exponential backoff, and provider failover chains.

import { logger } from './logger.js';
import type { CircuitState, CircuitBreakerState } from '../types.js';

export type { CircuitState, CircuitBreakerState };

// ── Circuit breaker ────────────────────────────────────────────────────────────

const FAILURE_THRESHOLD    = Number(process.env.CIRCUIT_FAILURE_THRESHOLD ?? 5);
const SUCCESS_THRESHOLD    = Number(process.env.CIRCUIT_SUCCESS_THRESHOLD ?? 2);
const OPEN_TIMEOUT_MS      = Number(process.env.CIRCUIT_OPEN_TIMEOUT_MS   ?? 30_000);

class CircuitBreaker {
  private failures   = 0;
  private successes  = 0;
  private state: CircuitState = 'closed';
  private openedAt?: number;
  private lastFailAt?: number;

  constructor(public readonly name: string) {}

  get isOpen(): boolean {
    if (this.state === 'open') {
      if (Date.now() - (this.openedAt ?? 0) > OPEN_TIMEOUT_MS) {
        this.state = 'half-open';
        this.successes = 0;
        logger.info('circuit_half_open', { name: this.name });
      }
    }
    return this.state === 'open';
  }

  recordSuccess(): void {
    this.failures = 0;
    if (this.state === 'half-open') {
      this.successes++;
      if (this.successes >= SUCCESS_THRESHOLD) {
        this.state = 'closed';
        logger.info('circuit_closed', { name: this.name });
      }
    }
  }

  recordFailure(): void {
    this.lastFailAt = Date.now();
    if (this.state === 'half-open') {
      this.open();
      return;
    }
    this.failures++;
    if (this.failures >= FAILURE_THRESHOLD) this.open();
  }

  private open(): void {
    this.state    = 'open';
    this.openedAt = Date.now();
    this.successes = 0;
    logger.warn('circuit_opened', { name: this.name, failures: this.failures });
  }

  reset(): void {
    this.failures = this.successes = 0;
    this.state    = 'closed';
    this.openedAt = this.lastFailAt = undefined;
    logger.info('circuit_reset', { name: this.name });
  }

  snapshot(): CircuitBreakerState {
    return {
      name:          this.name,
      state:         this.state,
      failures:      this.failures,
      successes:     this.successes,
      lastFailureAt: this.lastFailAt ? new Date(this.lastFailAt).toISOString() : undefined,
      openedAt:      this.openedAt   ? new Date(this.openedAt).toISOString()   : undefined,
      nextAttemptAt: this.state === 'open'
        ? new Date((this.openedAt ?? 0) + OPEN_TIMEOUT_MS).toISOString()
        : undefined,
    };
  }
}

// ── Circuit registry ──────────────────────────────────────────────────────────

const _circuits = new Map<string, CircuitBreaker>();

function getCircuit(name: string): CircuitBreaker {
  if (!_circuits.has(name)) _circuits.set(name, new CircuitBreaker(name));
  return _circuits.get(name)!;
}

export function listCircuits(): CircuitBreakerState[] {
  return [..._circuits.values()].map((c) => c.snapshot());
}

export function resetCircuit(name: string): void {
  getCircuit(name).reset();
}

export function isCircuitOpen(name: string): boolean {
  return getCircuit(name).isOpen;
}

// ── Protected execution ────────────────────────────────────────────────────────

export async function withCircuit<T>(
  name: string,
  fn: () => Promise<T>,
  fallback?: () => Promise<T>,
): Promise<T> {
  const cb = getCircuit(name);
  if (cb.isOpen) {
    if (fallback) return fallback();
    throw new Error(`Circuit '${name}' is open — dependency unavailable`);
  }
  try {
    const result = await fn();
    cb.recordSuccess();
    return result;
  } catch (e) {
    cb.recordFailure();
    if (fallback && cb.isOpen) return fallback();
    throw e;
  }
}

// ── Retry with exponential backoff ────────────────────────────────────────────

export interface RetryOpts {
  attempts?:   number;
  baseDelayMs?: number;
  maxDelayMs?:  number;
  jitter?:      boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const { attempts = 3, baseDelayMs = 200, maxDelayMs = 5_000, jitter = true } = opts;
  let lastErr: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e as Error;
      if (i < attempts - 1) {
        let delay = Math.min(baseDelayMs * 2 ** i, maxDelayMs);
        if (jitter) delay *= 0.5 + Math.random() * 0.5;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr ?? new Error('retry failed');
}

// ── Provider failover chain ────────────────────────────────────────────────────

export async function withFailoverChain<T>(
  providers: Array<{ name: string; fn: () => Promise<T> }>,
): Promise<{ result: T; provider: string }> {
  const errors: string[] = [];
  for (const { name, fn } of providers) {
    if (isCircuitOpen(name)) { errors.push(`${name}: circuit open`); continue; }
    try {
      const result = await fn();
      getCircuit(name).recordSuccess();
      return { result, provider: name };
    } catch (e) {
      getCircuit(name).recordFailure();
      errors.push(`${name}: ${(e as Error).message}`);
      logger.warn('failover_provider_error', { provider: name, error: (e as Error).message });
    }
  }
  throw new Error(`All providers failed:\n${errors.join('\n')}`);
}

// ── Health score ──────────────────────────────────────────────────────────────

const _healthScores = new Map<string, { score: number; updatedAt: number }>();

export function recordHealthScore(name: string, score: number): void {
  _healthScores.set(name, { score: Math.max(0, Math.min(100, score)), updatedAt: Date.now() });
}

export function getHealthScores(): Record<string, { score: number; updatedAt: string }> {
  const out: Record<string, { score: number; updatedAt: string }> = {};
  for (const [name, { score, updatedAt }] of _healthScores.entries()) {
    out[name] = { score, updatedAt: new Date(updatedAt).toISOString() };
  }
  return out;
}
