// ── Universal Search — provider implementations ───────────────────────────────
// Every provider speaks the same SearchProvider interface and fails soft: a
// network error, bad status or empty body resolves to [] so the manager can fall
// through to the next source. Keyed providers (Google, Tavily) activate the
// moment their env vars are present; keyless ones (GitHub, Wikipedia, Reddit) are
// always available as a free baseline.

import type { SearchHit, SearchProvider, SearchOptions } from "./types";

const UA = "Co.AISearch/1.0 (+https://coagentix.ai)";
const DEFAULT_TIMEOUT_MS = 6000;

/** fetch with a hard timeout, merged with any caller abort signal. */
async function timedFetch(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function clip(s: unknown, max = 320): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// ── Tavily — purpose-built LLM web search (keyed) ─────────────────────────────
const tavily: SearchProvider = {
  id: "tavily",
  label: "Tavily",
  isConfigured: () => Boolean(process.env.TAVILY_API_KEY?.trim()),
  async search(query, { limit, signal }) {
    try {
      const res = await timedFetch(
        "https://api.tavily.com/search",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query,
            max_results: limit,
            search_depth: "basic",
          }),
        },
        signal,
      );
      if (!res.ok) return [];
      const json = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
      return (json.results ?? []).slice(0, limit).map((r) => ({
        title: clip(r.title, 160) || r.url || "Result",
        url: String(r.url ?? ""),
        snippet: clip(r.content),
      }));
    } catch {
      return [];
    }
  },
};

// ── Google Programmable Search (keyed: key + cx) ──────────────────────────────
const google: SearchProvider = {
  id: "google",
  label: "Google",
  isConfigured: () =>
    Boolean(process.env.GOOGLE_CSE_KEY?.trim() && process.env.GOOGLE_CSE_CX?.trim()),
  async search(query, { limit, signal }) {
    try {
      const url =
        `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(process.env.GOOGLE_CSE_KEY!)}` +
        `&cx=${encodeURIComponent(process.env.GOOGLE_CSE_CX!)}&num=${Math.min(limit, 10)}&q=${encodeURIComponent(query)}`;
      const res = await timedFetch(url, { headers: { "User-Agent": UA } }, signal);
      if (!res.ok) return [];
      const json = (await res.json()) as { items?: Array<{ title?: string; link?: string; snippet?: string }> };
      return (json.items ?? []).slice(0, limit).map((r) => ({
        title: clip(r.title, 160) || r.link || "Result",
        url: String(r.link ?? ""),
        snippet: clip(r.snippet),
      }));
    } catch {
      return [];
    }
  },
};

// ── GitHub code/repo search (keyless; optional token raises rate limit) ───────
const github: SearchProvider = {
  id: "github",
  label: "GitHub",
  isConfigured: () => true,
  async search(query, { limit, signal }) {
    try {
      const headers: Record<string, string> = { "User-Agent": UA, Accept: "application/vnd.github+json" };
      const token = process.env.GITHUB_TOKEN?.trim();
      if (token) headers.Authorization = `Bearer ${token}`;
      const url = `https://api.github.com/search/repositories?per_page=${Math.min(limit, 10)}&q=${encodeURIComponent(query)}`;
      const res = await timedFetch(url, { headers }, signal);
      if (!res.ok) return [];
      const json = (await res.json()) as {
        items?: Array<{ full_name?: string; html_url?: string; description?: string; stargazers_count?: number }>;
      };
      return (json.items ?? []).slice(0, limit).map((r) => ({
        title: clip(r.full_name, 160) || "Repository",
        url: String(r.html_url ?? ""),
        snippet: clip(`${r.description ?? ""}${r.stargazers_count ? ` · ★${r.stargazers_count}` : ""}`),
      }));
    } catch {
      return [];
    }
  },
};

// ── Wikipedia (keyless) ───────────────────────────────────────────────────────
const wikipedia: SearchProvider = {
  id: "wikipedia",
  label: "Wikipedia",
  isConfigured: () => true,
  async search(query, { limit, signal }) {
    try {
      const url =
        "https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*" +
        `&srlimit=${Math.min(limit, 10)}&srsearch=${encodeURIComponent(query)}`;
      const res = await timedFetch(url, { headers: { "User-Agent": UA } }, signal);
      if (!res.ok) return [];
      const json = (await res.json()) as { query?: { search?: Array<{ title?: string; snippet?: string }> } };
      return (json.query?.search ?? []).slice(0, limit).map((r) => ({
        title: clip(r.title, 160) || "Article",
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(r.title ?? "").replace(/\s/g, "_"))}`,
        // The API returns HTML snippets — strip tags for a clean excerpt.
        snippet: clip(String(r.snippet ?? "").replace(/<[^>]+>/g, "")),
      }));
    } catch {
      return [];
    }
  },
};

// ── Reddit (keyless) ──────────────────────────────────────────────────────────
const reddit: SearchProvider = {
  id: "reddit",
  label: "Reddit",
  isConfigured: () => true,
  async search(query, { limit, signal }) {
    try {
      const url = `https://www.reddit.com/search.json?limit=${Math.min(limit, 10)}&q=${encodeURIComponent(query)}`;
      const res = await timedFetch(url, { headers: { "User-Agent": UA } }, signal);
      if (!res.ok) return [];
      const json = (await res.json()) as {
        data?: { children?: Array<{ data?: { title?: string; permalink?: string; selftext?: string; subreddit?: string } }> };
      };
      return (json.data?.children ?? []).slice(0, limit).map((c) => ({
        title: clip(c.data?.title, 160) || "Post",
        url: c.data?.permalink ? `https://www.reddit.com${c.data.permalink}` : "",
        snippet: clip(`${c.data?.subreddit ? `r/${c.data.subreddit} · ` : ""}${c.data?.selftext ?? ""}`),
      }));
    } catch {
      return [];
    }
  },
};

/** Providers in fallback priority order (spec §1: Google → Tavily → GitHub →
 *  Docs → Wikipedia → Reddit; "Docs" is served by the general web providers). */
export const SEARCH_PROVIDERS: SearchProvider[] = [google, tavily, github, wikipedia, reddit];

export type { SearchHit, SearchOptions };
