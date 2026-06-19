// ── Coagentix — Provider Health model (shared: server + client) ───────────────
// Types for the provider health-check + diagnostic status panel. The /api/health
// route produces a `SystemHealth`; the status panel renders it. Kept free of
// server-only imports so the UI can use the same types and helpers.

import type { CgntxProviderError } from "./errors";

/** Per-provider connectivity state. */
export type ProviderStatusLevel = "CONNECTED" | "DEGRADED" | "DISCONNECTED" | "UNKNOWN";

export interface ProviderHealth {
  id: string;
  /** Human label, e.g. "Claude (Anthropic)". */
  label: string;
  status: ProviderStatusLevel;
  /** Short status note, e.g. "Connected · 240ms" or "Missing API Key". */
  note: string;
  /** Whether an API key is configured for this provider at all. */
  configured: boolean;
  /** Whether this is the primary provider used for chat. */
  primary: boolean;
  /** Health-ping round-trip latency in ms, when measured. */
  latencyMs?: number;
  /** Active model id for this provider. */
  model?: string;
  /** Structured error, present when DISCONNECTED/DEGRADED due to a failure. */
  error?: CgntxProviderError;
  checkedAt: string;
}

/** Aggregate system state derived from the providers. */
export type SystemStatusLevel = "OPERATIONAL" | "DEGRADED" | "DOWN" | "UNKNOWN";

export interface ChecklistItem {
  label: string;
  ok: boolean;
  note?: string;
}

export interface SystemHealth {
  status: SystemStatusLevel;
  providers: ProviderHealth[];
  /** True when at least one provider is CONNECTED (AI can actually answer). */
  anyConnected: boolean;
  /** Startup-style checklist (keys loaded, database, etc.). */
  checklist: ChecklistItem[];
  checkedAt: string;
}

// ── Display helpers ───────────────────────────────────────────────────────────

const STATUS_DOT: Record<ProviderStatusLevel, string> = {
  CONNECTED: "🟢",
  DEGRADED: "🟡",
  DISCONNECTED: "🔴",
  UNKNOWN: "⚪",
};

export function statusDot(level: ProviderStatusLevel): string {
  return STATUS_DOT[level];
}

/** Derive the aggregate system status from a set of provider results. */
export function deriveSystemStatus(providers: ProviderHealth[]): SystemStatusLevel {
  if (providers.length === 0) return "UNKNOWN";
  const levels = providers.map((p) => p.status);
  if (levels.every((l) => l === "UNKNOWN")) return "UNKNOWN";
  const anyConnected = levels.some((l) => l === "CONNECTED");
  const anyUsable = anyConnected || levels.some((l) => l === "DEGRADED");
  // No provider can serve a request → the system is DOWN.
  if (!anyUsable) return "DOWN";
  // Something is wrong (a provider is down or degraded) but AI still works.
  if (anyConnected && levels.every((l) => l === "CONNECTED")) return "OPERATIONAL";
  return "DEGRADED";
}
