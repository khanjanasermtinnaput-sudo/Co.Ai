"use client";

// ── AI Pair Programming Panel (Phase 30) ─────────────────────────────────────
// Proactively surfaces high-impact suggestions as a non-disruptive sidebar.
// Runs static analysis on the virtual FS and groups by priority.
// Users can dismiss suggestions; AI-powered fixes stream a diff.

import { useState, useMemo, useCallback } from "react";
import {
  Bot, RefreshCw, X, Wand2, Loader2, ChevronRight,
  AlertTriangle, Zap, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { analyzePairSuggestions, type PairSuggestion } from "@/lib/cocode/pair-programming";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { PanelHeader } from "@/components/cocode/panel-header";

const PRIORITY_ICON: Record<string, React.ReactNode> = {
  high: <AlertTriangle className="size-3.5 text-red-400" />,
  medium: <Zap className="size-3.5 text-amber-400" />,
  low: <Info className="size-3.5 text-sky-400" />,
};

const KIND_LABEL: Record<string, string> = {
  "duplicate-logic": "Duplicate Logic",
  "missing-cache": "Missing Cache",
  "unnecessary-rerender": "Re-render",
  "simplify-hook": "Simplify Hook",
  "database-index": "DB Index",
  "bundle-size": "Bundle Size",
  "accessibility": "A11y",
  "security": "Security",
  "performance": "Performance",
  "code-quality": "Quality",
};

export function PairPanel({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const openTab = useCocodeIDEStore((s) => s.openTab);
  const setDiff = useCocodeIDEStore((s) => s.setDiff);
  const setRightPanel = useCocodeIDEStore((s) => s.setRightPanel);

  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [fixing, setFixing] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<PairSuggestion[] | null>(null);
  const [running, setRunning] = useState(false);

  const allFiles = useMemo(() => flattenFiles(fs), [fs]);

  const analyze = useCallback(async () => {
    setRunning(true);
    await new Promise((r) => setTimeout(r, 50));
    const s = analyzePairSuggestions(
      allFiles.map((f) => ({ path: f.path, content: f.content })),
      dismissed,
    );
    setSuggestions(s);
    setRunning(false);
  }, [allFiles, dismissed]);

  function dismiss(id: string) {
    setDismissed((d) => new Set([...d, id]));
    setSuggestions((s) => s?.filter((x) => x.id !== id) ?? null);
  }

  async function autoFix(sugg: PairSuggestion) {
    if (!sugg.autoFixable) return;
    setFixing(sugg.id);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Generate a unified git diff to fix: ${sugg.problem}\nSolution: ${sugg.solution}\n${sugg.file ? `File: ${sugg.file}` : ""}`,
        history: [],
        agent: "cocode",
        route: "fix",
      }),
    });

    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
      }
      const { extractDiffs } = await import("@/lib/cocode/diff");
      const diffs = extractDiffs(full);
      if (diffs.length) { setDiff(diffs[0]); setRightPanel("diff"); }
    }

    setFixing(null);
  }

  const grouped = useMemo(() => {
    if (!suggestions) return null;
    const high = suggestions.filter((s) => s.priority === "high");
    const medium = suggestions.filter((s) => s.priority === "medium");
    const low = suggestions.filter((s) => s.priority === "low");
    return { high, medium, low };
  }, [suggestions]);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <PanelHeader icon={Bot} title="AI Pair Programmer">
        {suggestions && (
          <span className="ml-auto text-[11px] text-muted-foreground/60">
            {suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""}
          </span>
        )}
        <Button size="sm" variant={suggestions ? "secondary" : "default"} onClick={analyze} disabled={running}>
          <RefreshCw className={cn("size-3.5", running && "animate-spin")} />
          {suggestions ? "Re-scan" : "Scan"}
        </Button>
      </PanelHeader>

      {!suggestions ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <Bot className="size-12 text-primary/30" />
          <div>
            <p className="font-medium">AI Pair Programmer</p>
            <p className="mt-1 text-[12px] text-muted-foreground/60">
              Scans your codebase for re-render issues, missing caches, security vulnerabilities, accessibility gaps, and more. Suggests fixes before you ask.
            </p>
          </div>
          <Button onClick={analyze} disabled={running || !allFiles.length}>
            <Bot className="size-3.5" /> Start Pairing
          </Button>
        </div>
      ) : suggestions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <Bot className="size-10 text-emerald-400/50" />
          <p className="text-sm font-medium text-emerald-400">Code looks great!</p>
          <p className="text-[12px] text-muted-foreground/60">No issues detected in the current codebase.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {grouped && (
            <>
              {(["high", "medium", "low"] as const).map((priority) => {
                const items = grouped[priority];
                if (items.length === 0) return null;
                return (
                  <div key={priority}>
                    <div className="sticky top-0 flex items-center gap-2 border-b border-border/40 bg-sidebar/80 px-4 py-1.5 backdrop-blur-sm">
                      {PRIORITY_ICON[priority]}
                      <span className="text-[11px] font-semibold capitalize">{priority} priority</span>
                      <span className="ml-auto text-[11px] text-muted-foreground/50">{items.length}</span>
                    </div>
                    {items.map((s) => (
                      <SuggestionCard
                        key={s.id}
                        suggestion={s}
                        onDismiss={() => dismiss(s.id)}
                        onFix={() => void autoFix(s)}
                        onOpenFile={() => s.file && openTab(s.file)}
                        fixing={fixing === s.id}
                      />
                    ))}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SuggestionCard({
  suggestion, onDismiss, onFix, onOpenFile, fixing,
}: {
  suggestion: PairSuggestion;
  onDismiss: () => void;
  onFix: () => void;
  onOpenFile: () => void;
  fixing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border/30">
      <button type="button" onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-start gap-2.5 px-4 py-3 text-left hover:bg-foreground/[0.03]">
        {PRIORITY_ICON[suggestion.priority]}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-secondary/40 px-1 py-0.5 text-[10px] text-muted-foreground/70">
              {KIND_LABEL[suggestion.kind] ?? suggestion.kind}
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-foreground/80">{suggestion.problem}</p>
          {suggestion.file && (
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpenFile(); }}
              className="mt-0.5 truncate text-[11px] text-primary/70 hover:text-primary">
              {suggestion.file}{suggestion.line ? `:${suggestion.line}` : ""}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {expanded ? null : <ChevronRight className="size-3.5 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="space-y-2 bg-card/20 px-4 pb-3 text-[11px]">
          <div>
            <span className="text-muted-foreground/50">Impact: </span>
            <span>{suggestion.impact}</span>
          </div>
          <div>
            <span className="text-muted-foreground/50">Solution: </span>
            <span className="text-emerald-300">{suggestion.solution}</span>
          </div>
          <div>
            <span className="text-muted-foreground/50">Benefit: </span>
            <span className="text-sky-300">{suggestion.estimatedBenefit}</span>
          </div>
          <div className="flex gap-2 pt-1">
            {suggestion.autoFixable && (
              <Button size="sm" className="flex-1" onClick={onFix} disabled={fixing}>
                {fixing
                  ? <><Loader2 className="size-3.5 animate-spin" /> Fixing…</>
                  : <><Wand2 className="size-3.5" /> Auto Fix</>}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              <X className="size-3.5" /> Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
