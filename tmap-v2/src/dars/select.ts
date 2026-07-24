// DARS — candidate enumeration + capability-scored selection (TDD §4.4).
// Improves on a fixed fallback-pair map: from the providers the user actually has
// keys for, pick the healthiest, most role-appropriate one — and try OpenRouter
// routes as additional backups.

import { PROVIDERS, resolveBaseURL, type CredentialBag } from '../config.js';
import type { Role, ResolvedProvider } from '../types.js';
import { HealthStore } from './health.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// Role × provider fit (0..1). Seeded from general strengths; can later be made
// data-driven from Agent Memory / eval telemetry (TDD §6.6). ollama/vllm are
// deliberately modest+neutral across every role: unlike a cloud vendor, their
// actual capability depends entirely on which model the operator pulled, not
// on this catalogue — so this is a floor estimate, not a claim of strength.
const ROLE_CAPABILITY: Record<Role, Record<string, number>> = {
  planner:   { gemini: 0.90, anthropic: 0.88, qwen: 0.80, llama: 0.72, deepseek: 0.70, ollama: 0.60, vllm: 0.60 },
  coder:     { deepseek: 0.92, anthropic: 0.90, qwen: 0.85, gemini: 0.72, llama: 0.62, ollama: 0.60, vllm: 0.60 },
  reviewer:  { anthropic: 0.89, qwen: 0.86, gemini: 0.82, deepseek: 0.76, llama: 0.70, ollama: 0.60, vllm: 0.60 },
  validator: { anthropic: 0.85, llama: 0.82, deepseek: 0.80, gemini: 0.76, qwen: 0.74, ollama: 0.60, vllm: 0.60 },
  // Architect: pre-plan design/trade-off reasoning — same profile as Planner,
  // weighted a bit further towards depth over speed.
  architect: { gemini: 0.90, anthropic: 0.88, qwen: 0.82, deepseek: 0.75, llama: 0.65, ollama: 0.60, vllm: 0.60 },
  // RAA: conversational requirement-gathering, largely in Thai — multilingual
  // fluency matters more here than raw coding/reasoning strength.
  raa:       { qwen: 0.90, anthropic: 0.85, gemini: 0.80, deepseek: 0.65, llama: 0.60, ollama: 0.55, vllm: 0.55 },
  // Documenter: low-stakes summarization of files already produced — capability
  // gaps matter less here, so cost/speed (see PROVIDER_COST/health scoring
  // below) do more of the work picking the actual winner.
  documenter:{ gemini: 0.82, anthropic: 0.80, qwen: 0.78, llama: 0.75, deepseek: 0.70, ollama: 0.60, vllm: 0.60 },
  // Debugger: root-cause diagnosis + targeted patch — same profile as Coder.
  debugger:  { deepseek: 0.92, anthropic: 0.90, qwen: 0.80, gemini: 0.70, llama: 0.62, ollama: 0.60, vllm: 0.60 },
  // Titan: heaviest reasoning role (multi-plan, devil's-advocate, 7-pass
  // self-review) — same ceiling as Architect, lower floor for cheap/local.
  titan:     { gemini: 0.90, anthropic: 0.90, qwen: 0.82, deepseek: 0.75, llama: 0.62, ollama: 0.55, vllm: 0.55 },
};

// Rough relative cost, 0 cheap .. 1 expensive. Local models are genuinely
// free (no metered API) — 0 is a real cost figure here, not a placeholder.
const PROVIDER_COST: Record<string, number> = {
  llama: 0.10, deepseek: 0.30, qwen: 0.40, gemini: 0.50, anthropic: 0.55, ollama: 0, vllm: 0,
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
          role, providerName: def.name, baseURL: resolveBaseURL(def), apiKey: direct.trim(),
          model: creds.models?.[pk] || def.defaultModel, mode: 'direct', protocol: def.protocol,
        },
      });
    }
  }

  // 2) OpenRouter — one key covers every vendor (added as backups). Local
  // models (ollama/vllm) are excluded: OpenRouter cannot reach an operator's
  // own localhost/private network, so there is no real route to offer.
  if (creds.openrouter?.trim()) {
    for (const pk of byCap) {
      const def = PROVIDERS[pk];
      if (def.noOpenRouter) continue;
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
