// DARS — candidate enumeration + capability-scored selection (TDD §4.4).
// Improves on a fixed fallback-pair map: from the providers the user actually has
// keys for, pick the healthiest, most role-appropriate one — and try OpenRouter
// routes as additional backups.

import { PROVIDERS, type CredentialBag } from '../config.js';
import type { Role, ResolvedProvider } from '../types.js';
import { HealthStore } from './health.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// Role × provider fit (0..1). Seeded from general strengths; can later be made
// data-driven from Agent Memory / eval telemetry (TDD §6.6).
const ROLE_CAPABILITY: Record<Role, Record<string, number>> = {
  planner:   { gemini: 0.90, qwen: 0.80, llama: 0.72, deepseek: 0.70 },
  coder:     { deepseek: 0.92, qwen: 0.85, gemini: 0.72, llama: 0.62 },
  reviewer:  { qwen: 0.86, gemini: 0.82, deepseek: 0.76, llama: 0.70 },
  validator: { llama: 0.82, deepseek: 0.80, gemini: 0.76, qwen: 0.74 },
};

// Rough relative cost, 0 cheap .. 1 expensive.
const PROVIDER_COST: Record<string, number> = {
  llama: 0.10, deepseek: 0.30, qwen: 0.40, gemini: 0.50,
};

export interface DarsCandidate {
  provider: ResolvedProvider;
  vendorKey: string; // 'gemini' | 'deepseek' | 'qwen' | 'llama'
  healthKey: string; // 'gemini' or 'openrouter:gemini' — the failure unit
}

/** All ways we can serve `role` given the user's credentials, capability-ordered. */
export function listProviderCandidates(role: Role, creds: CredentialBag): DarsCandidate[] {
  const out: DarsCandidate[] = [];
  const byCap = Object.keys(PROVIDERS).sort(
    (a, b) => (ROLE_CAPABILITY[role][b] ?? 0.5) - (ROLE_CAPABILITY[role][a] ?? 0.5),
  );

  // 1) Direct provider keys.
  for (const pk of byCap) {
    const def = PROVIDERS[pk];
    const direct = (creds as Record<string, unknown>)[pk];
    if (typeof direct === 'string' && direct.trim()) {
      out.push({
        vendorKey: pk,
        healthKey: pk,
        provider: {
          role, providerName: def.name, baseURL: def.baseURL, apiKey: direct.trim(),
          model: creds.models?.[pk] || def.defaultModel, mode: 'direct',
        },
      });
    }
  }

  // 2) OpenRouter — one key covers every vendor (added as backups).
  if (creds.openrouter?.trim()) {
    for (const pk of byCap) {
      const def = PROVIDERS[pk];
      out.push({
        vendorKey: pk,
        healthKey: `openrouter:${pk}`,
        provider: {
          role, providerName: `${def.name} (via OpenRouter)`, baseURL: OPENROUTER_BASE,
          apiKey: creds.openrouter.trim(), model: def.openrouterModel, mode: 'openrouter',
        },
      });
    }
  }

  return out;
}

function scoreCandidate(role: Role, cand: DarsCandidate, health: HealthStore): number {
  const h = health.get(cand.healthKey);
  const cap = ROLE_CAPABILITY[role][cand.vendorKey] ?? 0.5;
  const speed = 1 / (1 + h.ewmaLatencyMs / 1000);
  const rel = h.successRate;
  const cost = 1 - (PROVIDER_COST[cand.vendorKey] ?? 0.5);
  const orPenalty = cand.healthKey.startsWith('openrouter') ? -0.05 : 0; // extra hop
  return 0.50 * cap + 0.20 * rel + 0.15 * speed + 0.15 * cost + orPenalty;
}

/** Pick the best not-yet-tried, healthy candidate. Falls back to any untried one
 *  (half-open probe) if every option is currently circuit-open. */
export function pickHealthy(
  role: Role, candidates: DarsCandidate[], tried: Set<string>, health: HealthStore,
): DarsCandidate | null {
  const untried = candidates.filter((c) => !tried.has(c.healthKey));
  if (!untried.length) return null;
  const available = untried.filter((c) => health.isAvailable(c.healthKey));
  const pool = available.length ? available : untried; // last-resort probe
  return pool
    .map((c) => ({ c, s: scoreCandidate(role, c, health) }))
    .sort((a, b) => b.s - a.s)[0].c;
}
