// ── Co.AI — System Memory (Master Prompt Part 6.2, tier 4/4) ──────────────────
// Read-only snapshot of the system's own runtime configuration: which providers
// are reachable right now, what order each task category prefers them in, and
// which effort levels a request can select. This is a live read of the existing
// single-source-of-truth modules (model-registry.ts, ai-providers.ts, effort.ts)
// — not a second, hand-maintained copy of that configuration — so it can never
// drift out of sync with what the system actually does.
//
// Per the spec, "System Memory is read-only during runtime": there is
// deliberately no write path here, unlike the per-user ai_memory_v2 tiers
// (memory-context.ts).

import { configuredProviders, type KeyOverrides, type ProviderId } from "./ai-providers";
import { ROUTE_PRIORITY, type TaskCategory } from "./model-registry";
import { EFFORT_LEVELS } from "@/lib/effort";
import type { EffortLevel } from "@/lib/types";

export interface SystemMemorySnapshot {
  /** Provider priority order per task category — the Provider Router's (6.4)
   *  static eligibility ordering, before live health scoring reorders it
   *  (see provider-router.ts's configuredProvidersByScore). */
  taskRoutePriority: Record<TaskCategory, ProviderId[]>;
  /** Providers with a usable key right now (server env or per-user override). */
  configuredProviders: ProviderId[];
  /** Selectable reasoning-depth levels for a request. */
  effortLevels: EffortLevel[];
  checkedAt: string;
}

export function getSystemMemorySnapshot(overrides?: KeyOverrides): SystemMemorySnapshot {
  return {
    taskRoutePriority: ROUTE_PRIORITY,
    configuredProviders: configuredProviders(overrides).map((p) => p.id),
    effortLevels: EFFORT_LEVELS,
    checkedAt: new Date().toISOString(),
  };
}
