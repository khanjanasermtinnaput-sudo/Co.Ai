"use client";

// ── Live Diagnostics Panel (Phase 28) + Bug Investigation (Phase 29) ──────────
// Continuously monitors files for TS/ESLint/hydration/runtime errors.
// Bug Investigation: collects context → root cause → confidence → recommended fix.

import { useState, useMemo, useEffect } from "react";
import {
  AlertCircle, AlertTriangle, Info, Bug, RefreshCw,
  Loader2, ChevronDown, ChevronRight, Wrench, Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { analyzeFiles, parseConsoleMessage, type Diagnostic } from "@/lib/cocode/diagnostics";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { PanelHeader } from "@/components/cocode/panel-header";

// ── BugInvestigation ──────────────────────────────────────────────────────────

interface BugReport {
  error: string;
  rootCause: string;
  confidence: number;
  fix: string;
  regressionRisk: "low" | "medium" | "high";
  rollbackOption: boolean;
  generatingDiff: boolean;
}

function BugInvestigator() {
  const [errorText, setErrorText] = useState("");
  const [report, setReport] = useState<BugReport | null>(null);
  const [investigating, setInvestigating] = useState(false);
  const activeFile = useCocodeIDEStore((s) => s.activeFile());
  const setDiff = useCocodeIDEStore((s) => s.setDiff);
  const setRightPanel = useCocodeIDEStore((s) => s.setRightPanel);
  const github = useCocodeIDEStore((s) => s.github);

  async function investigate() {
    if (!errorText.trim()) return;
    setInvestigating(true);
    setReport(null);

    try {
      const context = [
        activeFile ? `Active file: ${activeFile.path}\n\`\`\`\n${activeFile.content.slice(0, 2000)}\n\`\`\`` : "",
        github.repo ? `Repository: ${github.repo.fullName} @ ${github.repo.branch}` : "",
      ].filter(Boolean).join("\n\n");

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Bug Investigation Request.\n\nError:\n${errorText}\n\nContext:\n${context}\n\nRespond with JSON only:\n{"rootCause":"...","confidence":0-100,"fix":"...","regressionRisk":"low|medium|high","rollbackOption":true|false}`,
          history: [],
          agent: "cocode",
          route: "debug",
        }),
      });

      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
      }

      // Extract JSON from response
      const jsonMatch = full.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as Omit<BugReport, "error" | "generatingDiff">;
          setReport({ error: errorText, ...parsed, generatingDiff: false });
        } catch {
          setReport({
            error: errorText,
            rootCause: full.slice(0, 500),
            confidence: 50,
            fix: "See analysis above",
            regressionRisk: "medium",
            rollbackOption: false,
            generatingDiff: false,
          });
        }
      }
    } finally {
      setInvestigating(false);
    }
  }

  async function generateFix() {
    if (!report) return;
    setReport((r) => r ? { ...r, generatingDiff: true } : r);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Generate a unified git diff to fix this bug:\nError: ${report.error}\nFix: ${report.fix}\n${activeFile ? `File: ${activeFile.path}\n\`\`\`\n${activeFile.content.slice(0, 2000)}\n\`\`\`` : ""}`,
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

    setReport((r) => r ? { ...r, generatingDiff: false } : r);
  }

  const riskColor = {
    low: "text-emerald-400",
    medium: "text-amber-400",
    high: "text-red-400",
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Bug className="size-4 text-red-400" />
        <span className="text-sm font-medium">Bug Investigator</span>
      </div>

      <textarea
        value={errorText}
        onChange={(e) => setErrorText(e.target.value)}
        placeholder="Paste error message, stack trace, or describe the bug…"
        rows={4}
        className="w-full resize-none rounded-xl border border-border/70 bg-background/50 px-3 py-2 text-[12px] outline-none placeholder:text-muted-foreground/40 focus:border-primary/40"
      />

      <Button
        className="w-full"
        onClick={() => void investigate()}
        disabled={investigating || !errorText.trim()}
      >
        {investigating ? <><Loader2 className="size-3.5 animate-spin" /> Investigating…</> : <><Search className="size-3.5" /> Investigate Bug</>}
      </Button>

      {report && (
        <div className="space-y-3 rounded-xl border border-border/60 bg-card/40 p-4">
          {/* Confidence */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/60">Confidence</span>
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-24 rounded-full bg-secondary/50">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${report.confidence}%` }}
                />
              </div>
              <span className="text-[12px] font-medium">{report.confidence}%</span>
            </div>
          </div>

          {/* Root Cause */}
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Root Cause</p>
            <p className="text-[12px]">{report.rootCause}</p>
          </div>

          {/* Fix */}
          <div>
            <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">Recommended Fix</p>
            <p className="text-[12px]">{report.fix}</p>
          </div>

          {/* Risk + rollback */}
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground/60">Regression Risk:
              <span className={cn("ml-1 font-medium", riskColor[report.regressionRisk])}>
                {report.regressionRisk}
              </span>
            </span>
            {report.rollbackOption && (
              <span className="text-emerald-400">Rollback available via checkpoints</span>
            )}
          </div>

          <Button
            className="w-full"
            size="sm"
            onClick={() => void generateFix()}
            disabled={report.generatingDiff}
          >
            {report.generatingDiff
              ? <><Loader2 className="size-3.5 animate-spin" /> Generating fix…</>
              : <><Wrench className="size-3.5" /> Generate Fix Diff</>}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main Diagnostics Panel ─────────────────────────────────────────────────────

export function DiagnosticsPanel({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const openTab = useCocodeIDEStore((s) => s.openTab);
  const [diags, setDiags] = useState<Diagnostic[]>([]);
  const [running, setRunning] = useState(false);
  const [showBugInvestigator, setShowBugInvestigator] = useState(false);
  const [filter, setFilter] = useState<"all" | "error" | "warning">("all");

  const allFiles = useMemo(() => flattenFiles(fs), [fs]);

  // Auto-run on mount only — analyze() is redefined every render, so it's
  // intentionally excluded from deps to avoid re-running on every state change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void analyze(); }, []);

  async function analyze() {
    setRunning(true);
    await new Promise((r) => setTimeout(r, 50));
    const d = analyzeFiles(allFiles.map((f) => ({ path: f.path, content: f.content })));
    setDiags(d);
    setRunning(false);
  }

  const filtered = diags.filter((d) =>
    filter === "all" || d.severity === filter,
  );
  const errorCount = diags.filter((d) => d.severity === "error").length;
  const warnCount = diags.filter((d) => d.severity === "warning").length;

  const SICON: Record<string, React.ReactNode> = {
    error: <AlertCircle className="size-3.5 shrink-0 text-red-400" />,
    warning: <AlertTriangle className="size-3.5 shrink-0 text-amber-400" />,
    info: <Info className="size-3.5 shrink-0 text-sky-400" />,
    hint: <Info className="size-3.5 shrink-0 text-muted-foreground/60" />,
  };

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <PanelHeader icon={AlertCircle} title="Diagnostics" className="flex-wrap">
        {diags.length > 0 && (
          <div className="flex items-center gap-2 text-[11px]">
            {errorCount > 0 && <span className="text-red-400">{errorCount} error{errorCount !== 1 ? "s" : ""}</span>}
            {warnCount > 0 && <span className="text-amber-400">{warnCount} warning{warnCount !== 1 ? "s" : ""}</span>}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => setShowBugInvestigator((b) => !b)} aria-label="Toggle bug investigator">
            <Bug className="size-3.5" />
          </Button>
          <Button size="sm" variant={diags.length ? "secondary" : "default"} onClick={analyze} disabled={running}>
            <RefreshCw className={cn("size-3.5", running && "animate-spin")} />
            Scan
          </Button>
        </div>
      </PanelHeader>

      {showBugInvestigator ? (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border/50">
          <BugInvestigator />
        </div>
      ) : (
        <>
          {/* Filter tabs */}
          <div className="flex gap-1 border-b border-border/50 px-2 py-1">
            {(["all", "error", "warning"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)}
                className={cn(
                  "rounded px-2 py-1 text-[11px] font-medium capitalize",
                  filter === f ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                )}>
                {f}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length === 0 && !running && (
              <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
                <AlertCircle className="size-8 text-muted-foreground/30" />
                <p className="text-[12px] text-muted-foreground/60">
                  {diags.length === 0 ? "Run a scan to detect issues." : "No issues match the current filter."}
                </p>
              </div>
            )}

            {filtered.map((d) => (
              <DiagRow key={d.id} diag={d} icon={SICON[d.severity]} onOpen={openTab} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DiagRow({
  diag, icon, onOpen,
}: {
  diag: Diagnostic;
  icon: React.ReactNode;
  onOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border/30">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-foreground/[0.03]"
      >
        {expanded
          ? <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          : <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
        {icon}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px]">{diag.message}</p>
          {diag.file && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onOpen(diag.file!); }}
              className="mt-0.5 truncate text-[11px] text-primary/70 hover:text-primary"
            >
              {diag.file}{diag.line ? `:${diag.line}` : ""}
            </button>
          )}
        </div>
        <span className="shrink-0 rounded bg-secondary/30 px-1 py-0.5 text-[10px] text-muted-foreground/60 capitalize">
          {diag.category}
        </span>
      </button>

      {expanded && (
        <div className="space-y-1.5 bg-card/20 px-10 pb-3 text-[11px]">
          <div>
            <span className="text-muted-foreground/50">Root cause: </span>
            <span>{diag.rootCause}</span>
          </div>
          <div>
            <span className="text-muted-foreground/50">Impact: </span>
            <span>{diag.impact}</span>
          </div>
          <div>
            <span className="text-muted-foreground/50">Fix: </span>
            <span className="text-emerald-400">{diag.recommendedFix}</span>
          </div>
          {diag.autoFixable && (
            <span className="inline-block rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
              Auto-fixable
            </span>
          )}
        </div>
      )}
    </div>
  );
}
