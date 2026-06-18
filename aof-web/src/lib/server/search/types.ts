// ── Universal Search — shared types ───────────────────────────────────────────

export type SearchMode = "auto" | "off" | "force";

export function normalizeSearchMode(v: unknown): SearchMode {
  return v === "off" || v === "force" || v === "auto" ? v : "auto";
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/**
 * A pluggable search source. Providers degrade gracefully: when not configured
 * (no API key) `isConfigured()` returns false and the manager skips them, exactly
 * like the AI provider chain in lib/server/ai-providers.ts.
 */
export interface SearchProvider {
  id: string;
  label: string;
  /** Keyless providers (Wikipedia, GitHub, Reddit) are always available. */
  isConfigured(): boolean;
  search(query: string, opts: SearchOptions): Promise<SearchHit[]>;
}

export interface SearchOptions {
  limit: number;
  signal?: AbortSignal;
}

export interface SearchOutcome {
  provider: string;
  query: string;
  hits: SearchHit[];
  retrievedAt: string;
}
