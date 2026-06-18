// DARS — the resilience wrapper around providers/client.ts `chat()` (TDD §4.5).
// Detect → select backup → switch → continue (without failing the job) → log.
// Agents call `chatWithDARS` instead of `chat`; the orchestrator is otherwise untouched.

import { chat } from '../providers/client.js';
import type { ChatMessage, ResolvedProvider, Role, ChatOpts } from '../types.js';
import type { CredentialBag } from '../config.js';
import { listProviderCandidates, pickHealthy } from './select.js';
import { HealthStore } from './health.js';
import { classifyError, retryAfterMs, type FailureKind } from './classify.js';

export type Emit = (role: string, text: string, kind?: 'status' | 'output' | 'error') => void;

export interface AgentLogEntry {
  ts: number;
  role: Role;
  provider: string;
  event: 'success' | 'failover' | 'low_quality';
  kind?: FailureKind;
  attempt: number;
  latencyMs?: number;
  error?: string;
}

export interface DarsContext {
  creds: CredentialBag;
  health: HealthStore;
  emit: Emit;
  sessionId: string;
  onLog?: (entry: AgentLogEntry) => void;
}

const PER_CALL_TIMEOUT = Number(process.env.NEXORA_CALL_TIMEOUT_MS || 45_000);
const MAX_FAILOVER = Number(process.env.NEXORA_MAX_FAILOVER || 4);

export interface DarsResult {
  text: string;
  provider: ResolvedProvider;
  attempts: number; // 0 = succeeded on first choice
}

export async function chatWithDARS(
  role: Role, messages: ChatMessage[], opts: ChatOpts, ctx: DarsContext,
): Promise<DarsResult> {
  const candidates = listProviderCandidates(role, ctx.creds);

  // No keys at all → mock mode (offline demo). Emit a visible warning so the
  // user knows they're getting a simulated response, not a real model answer.
  if (!candidates.length) {
    ctx.emit('system',
      `[MOCK] No API keys configured for role "${role}" — response is simulated. ` +
      'Add your provider key in Settings to get real AI responses.',
      'status',
    );
    const mock: ResolvedProvider = {
      role, providerName: `${role} (mock)`, baseURL: '', apiKey: '', model: 'mock', mode: 'mock',
    };
    return { text: await chat(mock, messages, opts), provider: mock, attempts: 0 };
  }

  const tried = new Set<string>();
  let lastErr: Error | undefined;

  for (let attempt = 0; attempt < MAX_FAILOVER; attempt++) {
    // Brief exponential backoff between failover attempts so a flaky provider
    // isn't hammered immediately. First attempt has no delay.
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, Math.min(100 * 2 ** (attempt - 1), 800)));
    }

    const cand = pickHealthy(role, candidates, tried, ctx.health);
    if (!cand) break;
    tried.add(cand.healthKey);

    const t0 = Date.now();
    try {
      const text = await callOnce(cand.provider, messages, opts);
      const latencyMs = Date.now() - t0;
      ctx.health.recordSuccess(cand.healthKey, latencyMs);

      if (isLowQuality(role, text)) {
        ctx.health.recordFailure(cand.healthKey, 'low_quality');
        log(ctx, { ts: Date.now(), role, provider: cand.provider.providerName, event: 'low_quality', attempt, latencyMs });
        ctx.emit('system', `${cand.provider.providerName} returned a low-quality result → trying another model`, 'status');
        lastErr = new Error('low-quality response');
        continue;
      }

      if (attempt > 0) {
        ctx.emit('system', `recovered on ${cand.provider.providerName}`, 'status');
      }
      log(ctx, { ts: Date.now(), role, provider: cand.provider.providerName, event: 'success', attempt, latencyMs });
      return { text, provider: cand.provider, attempts: attempt };
    } catch (e) {
      const err = e as Error;
      const kind = classifyError(err);
      ctx.health.recordFailure(cand.healthKey, kind, retryAfterMs(err));
      log(ctx, { ts: Date.now(), role, provider: cand.provider.providerName, event: 'failover', kind, attempt, error: err.message });
      ctx.emit('system', `${cand.provider.providerName} ${kind} → switching agent`, 'status');
      lastErr = err;
    }
  }

  throw new Error(`DARS: all providers exhausted for ${role}: ${lastErr?.message ?? 'no healthy provider'}`);
}

// One call with a hard timeout via AbortController.
async function callOnce(provider: ResolvedProvider, messages: ChatMessage[], opts: ChatOpts): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PER_CALL_TIMEOUT);
  try {
    return await chat(provider, messages, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

function isLowQuality(role: Role, text: string): boolean {
  const t = (text || '').trim();
  if (t.length < 2) return true;
  if (role === 'coder' && !t.includes('```')) return true; // coder must emit code fences
  return false;
}

function log(ctx: DarsContext, entry: AgentLogEntry): void {
  ctx.onLog?.(entry);
}
