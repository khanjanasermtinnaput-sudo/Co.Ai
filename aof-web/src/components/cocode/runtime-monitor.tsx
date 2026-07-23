"use client";

// ── Runtime Monitor (Phase 46) ────────────────────────────────────────────────
// Captures console messages relayed from the live-preview iframe via postMessage.
// Groups by level, enables AI-assisted fix for errors.

import { useState, useEffect, useRef, useCallback } from "react";
import { Activity, XCircle, AlertTriangle, Info, Trash2, Loader2, Bot, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { extractDiffs } from "@/lib/cocode/diff";
import { PanelHeader } from "@/components/cocode/panel-header";

type LogLevel = "error" | "warn" | "info" | "log" | "debug";

interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  stack?: string;
  timestamp: number;
  source?: string;
}

const LEVEL_CONFIG: Record<LogLevel, { icon: typeof XCircle; color: string; bg: string }> = {
  error: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/8" },
  warn: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/8" },
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/8" },
  log: { icon: Info, color: "text-slate-400", bg: "" },
  debug: { icon: Info, color: "text-muted-foreground/40", bg: "" },
};

const LEVEL_LABELS: LogLevel[] = ["error", "warn", "info", "log"];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function RuntimeMonitor({ className }: { className?: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogLevel | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [fixingId, setFixingId] = useState<string | null>(null);
  const [fixResult, setFixResult] = useState<string | null>(null);
  const setDiff = useCocodeIDEStore((s) => s.setDiff);
  const allFiles = useCocodeIDEStore((s) => s.allFiles);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Listen to postMessage from live preview iframe
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      const data = e.data as { type?: string; level?: string; message?: string; stack?: string; source?: string } | null;
      if (!data || data.type !== "console") return;
      const level = (data.level ?? "log") as LogLevel;
      setLogs((prev) => [...prev.slice(-200), {
        id: `${Date.now()}_${Math.random()}`,
        level,
        message: String(data.message ?? ""),
        stack: data.stack,
        source: data.source,
        timestamp: Date.now(),
      }]);
    }

    // Also capture native console errors in this window during dev
    const origError = console.error.bind(console);
    const patchedError = (...args: unknown[]) => {
      setLogs((prev) => [...prev.slice(-200), {
        id: `${Date.now()}_${Math.random()}`,
        level: "error",
        message: args.map(String).join(" "),
        timestamp: Date.now(),
        source: "console",
      }]);
      origError(...args);
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const filtered = filter === "all" ? logs : logs.filter((l) => l.level === filter);
  const counts: Record<LogLevel, number> = { error: 0, warn: 0, info: 0, log: 0, debug: 0 };
  for (const l of logs) counts[l.level] = (counts[l.level] ?? 0) + 1;

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function fixWithAI(log: LogEntry) {
    setFixingId(log.id);
    setFixResult(null);

    const files = allFiles();
    const context = files.slice(0, 5).map((f) => `// ${f.path}\n${f.content.slice(0, 600)}`).join("\n\n---\n\n");
    const prompt = `Fix the following runtime error in my codebase. Output only a unified git diff.

Error: ${log.message}
${log.stack ? `Stack: ${log.stack}` : ""}

Repository context:
${context}`;

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt, history: [], agent: "cocode", route: "code" }),
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
      const diffs = extractDiffs(full);
      if (diffs.length) {
        setDiff(diffs[0]);
        setFixResult("Diff ready in the Diff panel.");
      } else {
        setFixResult(full.slice(0, 300));
      }
    }
    setFixingId(null);
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <PanelHeader icon={Activity} title="Runtime Monitor">
        {counts.error > 0 && (
          <span className="ml-1 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-400">{counts.error}</span>
        )}
        <button type="button" onClick={() => setLogs([])} className="ml-auto text-muted-foreground/40 hover:text-muted-foreground" aria-label="Clear logs" title="Clear logs">
          <Trash2 className="size-3.5" />
        </button>
      </PanelHeader>

      {/* Filter bar */}
      <div className="flex items-center gap-1 border-b border-border/50 px-3 py-2">
        <button type="button" onClick={() => setFilter("all")}
          className={cn("rounded-md px-2 py-1 text-[11px] font-medium transition-colors", filter === "all" ? "bg-secondary/50 text-foreground" : "text-muted-foreground hover:text-foreground")}>
          All ({logs.length})
        </button>
        {LEVEL_LABELS.map((level) => {
          const cfg = LEVEL_CONFIG[level];
          return (
            <button key={level} type="button" onClick={() => setFilter(level === filter ? "all" : level)}
              className={cn("rounded-md px-2 py-1 text-[11px] font-medium capitalize transition-colors",
                filter === level ? "bg-secondary/50 text-foreground" : "text-muted-foreground hover:text-foreground",
                counts[level] > 0 && cfg.color)}>
              {level} {counts[level] > 0 && `(${counts[level]})`}
            </button>
          );
        })}
      </div>

      {/* Log list */}
      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[12px]">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground/50">
            <Activity className="size-8 opacity-20" />
            <p>No console output yet.</p>
            <p className="text-[11px]">Open the Live Preview panel to start capturing runtime messages.</p>
          </div>
        )}

        {filtered.map((log) => {
          const cfg = LEVEL_CONFIG[log.level] ?? LEVEL_CONFIG.log;
          const Icon = cfg.icon;
          const isExpanded = expanded.has(log.id);

          return (
            <div key={log.id} className={cn("border-b border-border/20 px-3 py-2", cfg.bg)}>
              <div className="flex items-start gap-2">
                <Icon className={cn("mt-0.5 size-3.5 shrink-0", cfg.color)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn("shrink-0 text-[10px] font-medium uppercase", cfg.color)}>{log.level}</span>
                    {log.source && <span className="text-muted-foreground/40 text-[10px]">{log.source}</span>}
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/30">{formatTime(log.timestamp)}</span>
                  </div>
                  <p className="mt-0.5 break-all">{log.message}</p>
                  {log.stack && (
                    <button type="button" onClick={() => toggleExpand(log.id)}
                      className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground">
                      <ChevronRight className={cn("size-3 transition-transform", isExpanded && "rotate-90")} />
                      Stack trace
                    </button>
                  )}
                  {isExpanded && log.stack && (
                    <pre className="mt-1 text-[10px] text-muted-foreground/60 whitespace-pre-wrap">{log.stack}</pre>
                  )}
                </div>
                {log.level === "error" && (
                  <button type="button" onClick={() => void fixWithAI(log)} disabled={fixingId === log.id}
                    className="shrink-0 rounded-md bg-primary/10 p-1 text-primary hover:bg-primary/20 disabled:opacity-50"
                    title="Fix with AI">
                    {fixingId === log.id ? <Loader2 className="size-3.5 animate-spin" /> : <Bot className="size-3.5" />}
                  </button>
                )}
              </div>
              {fixResult && fixingId === null && (
                <p className="mt-1 text-[11px] text-emerald-400">{fixResult}</p>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
