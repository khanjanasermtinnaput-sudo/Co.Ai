"use client";

// ── Semantic Code Search Panel (Phase 42) ────────────────────────────────────
// BM25-ranked full-text and symbol search across the virtual FS.

import { useState, useMemo, useCallback } from "react";
import { Search, Code2, FileCode, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { searchFiles, searchSymbols, type SearchResult, type SymbolResult } from "@/lib/cocode/semantic-search";

type SearchMode = "text" | "symbol";

const KIND_COLOR: Record<string, string> = {
  function: "text-blue-400 bg-blue-500/10",
  component: "text-violet-400 bg-violet-500/10",
  hook: "text-emerald-400 bg-emerald-500/10",
  class: "text-amber-400 bg-amber-500/10",
  interface: "text-cyan-400 bg-cyan-500/10",
  type: "text-pink-400 bg-pink-500/10",
  const: "text-slate-400 bg-slate-500/10",
};

export function SemanticSearchPanel({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const openTab = useCocodeIDEStore((s) => s.openTab);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("text");
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  const allFiles = useMemo(() => flattenFiles(fs).map((f) => ({ path: f.path, content: f.content })), [fs]);

  const textResults = useMemo<SearchResult[]>(() => {
    if (mode !== "text" || !query.trim()) return [];
    return searchFiles(allFiles, { query, useRegex, caseSensitive, maxResults: 80 });
  }, [allFiles, query, mode, useRegex, caseSensitive]);

  const symbolResults = useMemo<SymbolResult[]>(() => {
    if (mode !== "symbol" || !query.trim()) return [];
    return searchSymbols(allFiles, query);
  }, [allFiles, query, mode]);

  const totalResults = mode === "text" ? textResults.length : symbolResults.length;

  function openResult(path: string) {
    openTab(path);
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <Search className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Code Search</span>
        {totalResults > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground/50">{totalResults} results</span>
        )}
      </div>

      {/* Search controls */}
      <div className="space-y-2 border-b border-border/50 p-3">
        <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-background/50 px-3 py-2 focus-within:border-primary/40">
          <Search className="size-3.5 shrink-0 text-muted-foreground/50" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "text" ? "Search code…" : "Search symbols…"}
            className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/30"
            autoFocus
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="text-muted-foreground/40 hover:text-muted-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>

        {/* Mode + options */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border/40 overflow-hidden">
            <button type="button" onClick={() => setMode("text")}
              className={cn("px-3 py-1 text-[11px] font-medium transition-colors", mode === "text" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
              Text
            </button>
            <button type="button" onClick={() => setMode("symbol")}
              className={cn("px-3 py-1 text-[11px] font-medium transition-colors", mode === "symbol" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
              Symbol
            </button>
          </div>
          {mode === "text" && (
            <>
              <button type="button" onClick={() => setUseRegex((v) => !v)}
                title="Use regular expression"
                className={cn("rounded px-2 py-1 text-[11px] font-mono transition-colors", useRegex ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
                .*
              </button>
              <button type="button" onClick={() => setCaseSensitive((v) => !v)}
                title="Case sensitive"
                className={cn("rounded px-2 py-1 text-[11px] transition-colors", caseSensitive ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
                Aa
              </button>
            </>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!query.trim() && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Search className="size-8 text-muted-foreground/20" />
            <p className="text-[12px] text-muted-foreground/50">
              {mode === "text" ? "Type to search across all files" : "Type to find symbols (functions, classes, types)"}
            </p>
          </div>
        )}

        {mode === "text" && textResults.length > 0 && (
          <div className="divide-y divide-border/30">
            {textResults.map((r, i) => (
              <button key={i} type="button"
                onClick={() => openResult(r.path)}
                className="flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-foreground/5 transition-colors">
                <div className="flex items-center gap-2">
                  <FileCode className="size-3 shrink-0 text-muted-foreground/40" />
                  <span className="truncate text-[11px] text-muted-foreground/60">{r.path}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/40">:{r.line}</span>
                </div>
                <p className="font-mono text-[12px] text-foreground/80">{r.preview}</p>
              </button>
            ))}
          </div>
        )}

        {mode === "symbol" && symbolResults.length > 0 && (
          <div className="divide-y divide-border/30">
            {symbolResults.map((r, i) => (
              <button key={i} type="button"
                onClick={() => openResult(r.path)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-foreground/5 transition-colors">
                <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", KIND_COLOR[r.kind] ?? "text-foreground bg-secondary/30")}>
                  {r.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[13px]">{r.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground/50">{r.path}:{r.line}</p>
                </div>
                <Code2 className="size-3.5 shrink-0 text-muted-foreground/30" />
              </button>
            ))}
          </div>
        )}

        {query.trim() && totalResults === 0 && (
          <div className="py-12 text-center text-[12px] text-muted-foreground/50">
            No results for <span className="font-mono">&quot;{query}&quot;</span>
          </div>
        )}
      </div>
    </div>
  );
}
