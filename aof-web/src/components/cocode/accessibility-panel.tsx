"use client";

// ── Accessibility Audit Panel (Phase 47) ─────────────────────────────────────
// WCAG 2.1 compliance scanner with AI fix suggestions.

import { useState, useMemo } from "react";
import { Accessibility, XCircle, AlertTriangle, Info, Loader2, Bot, CheckCircle2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { flattenFiles } from "@/lib/cocode/virtual-fs";
import { auditFiles, a11yScore, type A11yFinding, type A11ySeverity } from "@/lib/cocode/accessibility-audit";
import { extractDiffs } from "@/lib/cocode/diff";

const SEV_CONFIG: Record<A11ySeverity, { icon: typeof XCircle; color: string; bg: string; label: string }> = {
  error: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/10", label: "Error" },
  warning: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", label: "Warning" },
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10", label: "Info" },
};

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 90 ? "text-emerald-400" : score >= 70 ? "text-amber-400" : "text-red-400";
  const label = score >= 90 ? "Excellent" : score >= 70 ? "Needs Work" : "Poor";
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 p-4">
      <div className={cn("text-4xl font-bold tabular-nums", color)}>{score}</div>
      <div>
        <p className={cn("text-sm font-semibold", color)}>{label}</p>
        <p className="text-[11px] text-muted-foreground/60">Accessibility Score</p>
      </div>
    </div>
  );
}

export function AccessibilityPanel({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const setDiff = useCocodeIDEStore((s) => s.setDiff);
  const openTab = useCocodeIDEStore((s) => s.openTab);

  const allFiles = useMemo(() => flattenFiles(fs).map((f) => ({ path: f.path, content: f.content })), [fs]);

  const [scanned, setScanned] = useState(false);
  const [findings, setFindings] = useState<A11yFinding[]>([]);
  const [filterSev, setFilterSev] = useState<A11ySeverity | "all">("all");
  const [fixingId, setFixingId] = useState<string | null>(null);

  const score = useMemo(() => a11yScore(findings), [findings]);

  function scan() {
    setFindings(auditFiles(allFiles));
    setScanned(true);
  }

  const filtered = filterSev === "all" ? findings : findings.filter((f) => f.severity === filterSev);
  const counts: Record<A11ySeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;

  async function fixWithAI(finding: A11yFinding) {
    setFixingId(finding.id);
    const file = allFiles.find((f) => f.path === finding.file);
    if (!file) { setFixingId(null); return; }

    const prompt = `Fix this WCAG accessibility issue in the file. Output a unified git diff.

Issue: ${finding.description}
Fix: ${finding.fix}
WCAG: ${finding.wcagCriteria} (Level ${finding.wcagLevel})
File: ${finding.file}
Line: ${finding.line}
Snippet: ${finding.snippet}

File content:
\`\`\`
${file.content.slice(0, 2000)}
\`\`\``;

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
      if (diffs.length) setDiff(diffs[0]);
    }
    setFixingId(null);
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <Accessibility className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Accessibility Audit</span>
        {counts.error > 0 && (
          <span className="ml-1 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-400">{counts.error} errors</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="p-4 space-y-4">
          {/* Score */}
          {scanned && <ScoreGauge score={score} />}

          {/* Scan button */}
          <Button onClick={scan} className="w-full" variant={scanned ? "secondary" : "default"}>
            <RefreshCw className="size-3.5" />
            {scanned ? "Re-scan" : "Scan for Accessibility Issues"}
          </Button>

          {scanned && findings.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="size-10 text-emerald-400" />
              <p className="text-[13px] font-medium text-emerald-400">No issues found!</p>
              <p className="text-[12px] text-muted-foreground/60">All scanned files pass the WCAG 2.1 checks.</p>
            </div>
          )}

          {scanned && findings.length > 0 && (
            <>
              {/* Filter */}
              <div className="flex gap-2">
                <button type="button" onClick={() => setFilterSev("all")}
                  className={cn("flex-1 rounded-lg border py-1.5 text-[11px] font-medium transition-colors",
                    filterSev === "all" ? "border-primary/50 bg-primary/15 text-primary" : "border-border/50 text-muted-foreground")}>
                  All ({findings.length})
                </button>
                {(["error", "warning", "info"] as A11ySeverity[]).map((sev) => (
                  <button key={sev} type="button" onClick={() => setFilterSev(sev === filterSev ? "all" : sev)}
                    className={cn("flex-1 rounded-lg border py-1.5 text-[11px] font-medium capitalize transition-colors",
                      filterSev === sev ? "border-primary/50 bg-primary/15 text-primary" : "border-border/50 text-muted-foreground",
                      counts[sev] > 0 && SEV_CONFIG[sev].color)}>
                    {sev} ({counts[sev]})
                  </button>
                ))}
              </div>

              {/* Findings list */}
              <div className="space-y-2">
                {filtered.map((f) => {
                  const cfg = SEV_CONFIG[f.severity];
                  const Icon = cfg.icon;
                  return (
                    <div key={f.id} className={cn("rounded-xl border border-border/40 p-3", cfg.bg)}>
                      <div className="mb-2 flex items-start gap-2">
                        <Icon className={cn("mt-0.5 size-3.5 shrink-0", cfg.color)} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-medium">{f.description}</p>
                          <p className="text-[11px] text-muted-foreground/60 mt-0.5">{f.file}:{f.line} · {f.wcagCriteria}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="rounded bg-secondary/40 px-1 py-0.5 text-[10px] font-mono text-muted-foreground/70">
                            WCAG {f.wcagLevel}
                          </span>
                          <button type="button" onClick={() => void fixWithAI(f)}
                            disabled={fixingId === f.id}
                            className="rounded-md bg-primary/10 p-1 text-primary hover:bg-primary/20 disabled:opacity-50"
                            title="Fix with AI">
                            {fixingId === f.id ? <Loader2 className="size-3 animate-spin" /> : <Bot className="size-3" />}
                          </button>
                        </div>
                      </div>
                      {f.snippet && (
                        <code className="block rounded bg-black/30 px-2 py-1 text-[11px] text-slate-400 font-mono mb-2 truncate">{f.snippet}</code>
                      )}
                      <p className="text-[11px] text-muted-foreground/70">
                        <span className="font-medium text-foreground/60">Fix: </span>{f.fix}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
