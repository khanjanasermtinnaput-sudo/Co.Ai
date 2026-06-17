// ── Search Manager ────────────────────────────────────────────────────────────
// The brain of the Universal Search layer. Decides (1) whether a query needs live
// web search, and (2) which provider serves it — trying configured providers in
// priority order and falling through on failure or empty results, mirroring the
// AI provider failover chain.

import { SEARCH_PROVIDERS } from "./providers";
import type { SearchMode, SearchOutcome } from "./types";

/** Signals that a question likely needs fresh, post-training information. */
const FRESHNESS_RE =
  /\b(latest|newest|today|tonight|yesterday|recent|recently|current|currently|now|this (week|month|year)|breaking|news|update|updated|release[ds]?|version|changelog|deprecat|price|stock|score|weather|forecast|live|2024|2025|2026)\b/i;

/** "How do I use X / docs / vs / error" — benefits from real docs & discussion. */
const LOOKUP_RE =
  /\b(documentation|docs|api reference|how to (install|use|configure)|changelog|migration guide|release notes)\b/i;

export interface SearchDecision {
  search: boolean;
  /** A concise reason, surfaced in logs and (optionally) the UI. */
  reason: string;
}

/**
 * Decide whether to search. OFF never searches; FORCE always does; AUTO uses the
 * caller's route hint plus freshness/lookup heuristics.
 */
export function decideSearch(
  message: string,
  mode: SearchMode,
  routeTarget?: string,
): SearchDecision {
  if (mode === "off") return { search: false, reason: "search disabled" };
  if (mode === "force") return { search: true, reason: "force search" };

  if (routeTarget === "search") return { search: true, reason: "router classified as search" };
  if (FRESHNESS_RE.test(message)) return { search: true, reason: "freshness signal in query" };
  if (LOOKUP_RE.test(message)) return { search: true, reason: "documentation lookup" };
  return { search: false, reason: "model knowledge sufficient" };
}

/** True when at least one search provider could run (always true — keyless ones). */
export function searchAvailable(): boolean {
  return SEARCH_PROVIDERS.some((p) => p.isConfigured());
}

/** Provider ids that are actually usable right now (for diagnostics/UI). */
export function configuredSearchProviders(): string[] {
  return SEARCH_PROVIDERS.filter((p) => p.isConfigured()).map((p) => p.id);
}

/**
 * Run the search across providers in priority order, returning the first non-empty
 * result set. Returns null when nothing was found (or everything failed) so the
 * caller can answer from model knowledge instead.
 */
export async function runSearch(
  query: string,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<SearchOutcome | null> {
  const q = query.trim().slice(0, 400);
  if (!q) return null;
  const limit = opts.limit ?? 5;

  for (const provider of SEARCH_PROVIDERS) {
    if (!provider.isConfigured()) continue;
    try {
      const hits = await provider.search(q, { limit, signal: opts.signal });
      const clean = hits.filter((h) => h.url && h.title);
      if (clean.length) {
        return {
          provider: provider.label,
          query: q,
          hits: clean.slice(0, limit),
          retrievedAt: new Date().toISOString(),
        };
      }
    } catch {
      // try the next provider
    }
  }
  return null;
}
