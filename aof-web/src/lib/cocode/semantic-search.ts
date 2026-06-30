// ── Semantic Code Search (Phase 42) ──────────────────────────────────────────
// BM25-ranked full-text search over the virtual FS with code-aware scoring.
// Supports regex, symbol search, and multi-keyword queries.

export interface SearchResult {
  path: string;
  line: number;
  col: number;
  preview: string;
  score: number;
  matchType: "exact" | "regex" | "fuzzy";
}

export interface SearchOptions {
  query: string;
  useRegex?: boolean;
  caseSensitive?: boolean;
  includeGlob?: string;
  maxResults?: number;
}

// ── BM25 parameters ───────────────────────────────────────────────────────────

const K1 = 1.5;
const B = 0.75;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_$]+/g) ?? [];
}

function bm25Score(
  queryTerms: string[],
  docTerms: string[],
  avgDocLen: number,
): number {
  const termFreq: Record<string, number> = {};
  for (const t of docTerms) termFreq[t] = (termFreq[t] ?? 0) + 1;
  const dl = docTerms.length;

  let score = 0;
  for (const term of queryTerms) {
    const tf = termFreq[term] ?? 0;
    if (!tf) continue;
    const numerator = tf * (K1 + 1);
    const denominator = tf + K1 * (1 - B + B * (dl / avgDocLen));
    score += numerator / denominator;
  }
  return score;
}

// ── Core search ───────────────────────────────────────────────────────────────

export function searchFiles(
  files: Array<{ path: string; content: string }>,
  opts: SearchOptions,
): SearchResult[] {
  const { query, useRegex = false, caseSensitive = false, includeGlob, maxResults = 100 } = opts;
  if (!query.trim()) return [];

  // Glob filter
  let filtered = files;
  if (includeGlob) {
    const pat = includeGlob.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".");
    const re = new RegExp(pat);
    filtered = files.filter((f) => re.test(f.path));
  }

  const results: SearchResult[] = [];
  const avgDocLen = filtered.reduce((a, f) => a + f.content.length / 10, 0) / Math.max(filtered.length, 1);
  const queryTerms = tokenize(query);

  let matchRe: RegExp;
  try {
    matchRe = useRegex
      ? new RegExp(query, caseSensitive ? "g" : "gi")
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
  } catch {
    return [];
  }

  for (const { path, content } of filtered) {
    const lines = content.split("\n");
    const docTerms = tokenize(content);
    const fileScore = bm25Score(queryTerms, docTerms, avgDocLen);

    let lineIdx = 0;
    for (const line of lines) {
      lineIdx++;
      matchRe.lastIndex = 0;
      let matchResult: RegExpExecArray | null;
      while ((matchResult = matchRe.exec(line)) !== null) {
        const col = matchResult.index;
        const start = Math.max(0, col - 30);
        const end = Math.min(line.length, col + query.length + 30);
        const preview = (start > 0 ? "…" : "") + line.slice(start, end).trim() + (end < line.length ? "…" : "");

        results.push({
          path,
          line: lineIdx,
          col,
          preview,
          score: fileScore + 1,
          matchType: useRegex ? "regex" : "exact",
        });

        if (!matchRe.global) break;
        if (matchResult[0].length === 0) { matchRe.lastIndex++; }
      }
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// ── Symbol search (exports, classes, functions) ───────────────────────────────

export interface SymbolResult {
  path: string;
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "component";
  line: number;
}

export function searchSymbols(
  files: Array<{ path: string; content: string }>,
  query: string,
): SymbolResult[] {
  const q = query.toLowerCase();
  const results: SymbolResult[] = [];

  const patterns: Array<{ re: RegExp; kind: SymbolResult["kind"] }> = [
    { re: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g, kind: "function" },
    { re: /(?:export\s+)?class\s+(\w+)/g, kind: "class" },
    { re: /(?:export\s+)?interface\s+(\w+)/g, kind: "interface" },
    { re: /(?:export\s+)?type\s+(\w+)\s*=/g, kind: "type" },
    { re: /(?:export\s+)?const\s+(\w+)\s*=/g, kind: "const" },
  ];

  for (const { path, content } of files) {
    const lines = content.split("\n");
    for (const { re, kind } of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const name = m[1];
        if (!name.toLowerCase().includes(q)) continue;
        const charIdx = m.index;
        const line = content.slice(0, charIdx).split("\n").length;
        const isComponent = kind === "function" && /^[A-Z]/.test(name) &&
          (path.endsWith(".tsx") || path.endsWith(".jsx"));
        results.push({ path, name, kind: isComponent ? "component" : kind, line });
      }
    }
  }

  return results.slice(0, 100);
}
