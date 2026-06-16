// ── Aof AI — Unified Model Registry ────────────────────────────────────────────
// Single source of truth for every model Aof can call: which provider serves it,
// what it's good at, its context window and rough cost tier. The provider
// registry (ai-providers.ts) and the chat route both read from here instead of
// hardcoding model ids or per-task provider orders inline.

import type { ProviderId } from "./ai-providers";

export type Capability = "chat" | "vision" | "reasoning" | "coding" | "long-context";

export type TaskCategory = "chat" | "coding" | "research" | "reasoning";

export type CostTier = "free" | "low" | "medium" | "high";

export interface ModelDef {
  provider: ProviderId;
  model: string;
  capabilities: Capability[];
  contextWindow: number;
  costTier: CostTier;
}

export const MODEL_REGISTRY: ModelDef[] = [
  // ── Anthropic ──────────────────────────────────────────────────────────────
  { provider: "anthropic", model: "claude-haiku-4-5-20251001", capabilities: ["chat", "reasoning", "coding"], contextWindow: 200_000, costTier: "medium" },

  // ── Gemini ─────────────────────────────────────────────────────────────────
  { provider: "gemini", model: "gemini-2.5-pro", capabilities: ["chat", "vision", "reasoning", "coding"], contextWindow: 1_048_576, costTier: "medium" },
  { provider: "gemini", model: "gemini-2.5-flash", capabilities: ["chat", "vision", "reasoning", "coding"], contextWindow: 1_048_576, costTier: "low" },
  { provider: "gemini", model: "gemini-2.5-flash-lite", capabilities: ["chat", "coding"], contextWindow: 1_048_576, costTier: "free" },

  // ── DeepSeek ───────────────────────────────────────────────────────────────
  { provider: "deepseek", model: "deepseek-chat", capabilities: ["chat", "coding"], contextWindow: 64_000, costTier: "low" },
  { provider: "deepseek", model: "deepseek-reasoner", capabilities: ["chat", "reasoning", "coding"], contextWindow: 64_000, costTier: "low" },

  // ── Qwen ─────────────────────────────────────────────────────────────────
  // "coding" is reserved for the qwen-coder specialist so task-based routing
  // (bestModelFor) picks it over the general-purpose qwen-plus for code tasks.
  { provider: "qwen", model: "qwen-plus", capabilities: ["chat", "long-context"], contextWindow: 131_072, costTier: "low" },
  { provider: "qwen", model: "qwen-turbo", capabilities: ["chat", "long-context"], contextWindow: 131_072, costTier: "free" },
  { provider: "qwen", model: "qwen-coder", capabilities: ["chat", "coding", "long-context"], contextWindow: 131_072, costTier: "low" },

  // ── Llama ──────────────────────────────────────────────────────────────────
  { provider: "llama", model: "llama-4-maverick", capabilities: ["chat", "reasoning"], contextWindow: 128_000, costTier: "medium" },
  { provider: "llama", model: "llama-4-scout", capabilities: ["chat", "reasoning"], contextWindow: 128_000, costTier: "low" },
  { provider: "llama", model: "llama-3.3-70b", capabilities: ["chat", "reasoning"], contextWindow: 128_000, costTier: "free" },

  // ── OpenRouter — passthrough gateway, model chosen per request (see ai-providers.ts) ──
  { provider: "openrouter", model: "google/gemma-4-31b-it:free", capabilities: ["chat", "coding", "reasoning"], contextWindow: 32_000, costTier: "free" },
];

/** All models registered for one provider, in registry order. */
export function modelsFor(provider: ProviderId): ModelDef[] {
  return MODEL_REGISTRY.filter((m) => m.provider === provider);
}

/** Best model for a provider given a task, preferring the matching capability;
 *  falls back to the provider's first registered model when none match. */
export function bestModelFor(provider: ProviderId, task: TaskCategory): string | undefined {
  const wanted = TASK_CAPABILITY[task];
  const models = modelsFor(provider);
  return (models.find((m) => m.capabilities.includes(wanted)) ?? models[0])?.model;
}

const TASK_CAPABILITY: Record<TaskCategory, Capability> = {
  chat: "chat",
  coding: "coding",
  research: "reasoning",
  reasoning: "reasoning",
};

// ── Task-aware routing priority ────────────────────────────────────────────────
// Order providers are tried in for each task category. OpenRouter is appended to
// every chain as the universal last-resort gateway (it can reach many models with
// one key, including free ones) — see Step 5 of the integration spec.

export const ROUTE_PRIORITY: Record<TaskCategory, ProviderId[]> = {
  chat: ["gemini", "anthropic", "deepseek", "qwen", "llama", "openrouter"],
  coding: ["anthropic", "deepseek", "qwen", "gemini", "openrouter"],
  research: ["gemini", "anthropic", "deepseek", "openrouter"],
  reasoning: ["gemini", "anthropic", "deepseek", "openrouter"],
};

/** Provider order for a task, deduplicated and always ending with openrouter
 *  (when not already present) so there is always a final catch-all. */
export function routeOrder(task: TaskCategory): ProviderId[] {
  const order = ROUTE_PRIORITY[task] ?? ROUTE_PRIORITY.chat;
  return order.includes("openrouter") ? order : [...order, "openrouter"];
}
