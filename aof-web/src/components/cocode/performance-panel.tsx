"use client";

// ── Performance Profiler (Phase 35) ──────────────────────────────────────────
// Core Web Vitals risk analysis, bundle size breakdown, slow component detection.

import { useMemo, useState } from "react";
import {
  Gauge, RefreshCw, AlertTriangle, CheckCircle2,
  FileCode, Zap, ChevronRight, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import { profilePerformance, type PerformanceReport } from "@/lib/cocode/performance-profiler";
import { flattenFiles } from "@/lib/cocode/virtual-fs";

const RISK_COLOR = { high: "text-red-400", medium: "text-amber-400", low: "text-emerald-400" };
const RISK_BG = { high: "bg-red-500/10 border-red-500/30", medium: "bg-amber-500/10 border-amber-500/30", low: "bg-emerald-500/10 border-emerald-500/30" };

const METRIC_DESC: Record<string, string> = {
  LCP: "Largest Contentful Paint — time to render the largest visible element",
  FID: "First Input Delay — responsiveness to first user interaction",
  CLS: "Cumulative Layout Shift — visual stability during load",
  INP: "Interaction to Next Paint — overall responsiveness",
  TTFB: "Time to First Byte — server response speed",
  FCP: "First Contentful Paint — time to first text/image",
};

export function PerformancePanel({ className }: { className?: string }) {
  const fs = useCocodeIDEStore((s) => s.fs);
  const openTab = useCocodeIDEStore((s) => s.openTab);
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [running, setRunning] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>("cwv");

  const allFiles = useMemo(() => flattenFiles(fs).map((f) => ({ path: f.path, content: f.content })), [fs]);

  async function analyze() {
    setRunning(true);
    await new Promise((r) => setTimeout(r, 50));
    setReport(profilePerformance(allFiles));
    setRunning(false);
    setExpandedSection("cwv");
  }

  function scoreColor(s: number) {
    if (s >= 80) return "text-emerald-400";
    if (s >= 50) return "text-amber-400";
    return "text-red-400";
  }

  function scoreLabel(s: number) {
    if (s >= 80) return "Good";
    if (s >= 50) return "Needs Improvement";
    return "Poor";
  }

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-border/70 px-4 py-2.5">
        <Gauge className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Performance Profiler</span>
        {report && (
          <span className={cn("ml-auto text-[12px] font-semibold", scoreColor(report.score))}>
            {report.score}/100 · {scoreLabel(report.score)}
          </span>
        )}
        <Button size="sm" variant={report ? "secondary" : "default"} onClick={analyze} disabled={running || !allFiles.length}>
          <RefreshCw className={cn("size-3.5", running && "animate-spin")} />
          {report ? "Re-scan" : "Analyze"}
        </Button>
      </div>

      {!report ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <Gauge className="size-12 text-muted-foreground/30" />
          <div>
            <p className="font-medium">Performance Profiler</p>
            <p className="mt-1 text-[12px] text-muted-foreground/60">
              Analyzes Core Web Vitals risks, bundle size, slow components, and missing optimizations.
            </p>
          </div>
          <Button onClick={analyze} disabled={!allFiles.length}>
            <Zap className="size-3.5" /> Analyze Performance
          </Button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-border/50">
          {/* Score + bundle size */}
          <div className="flex items-center gap-4 px-4 py-3">
            <div className="relative size-16">
              <svg viewBox="0 0 60 60" className="size-full -rotate-90">
                <circle cx="30" cy="30" r="24" fill="none" stroke="currentColor" strokeWidth="6" className="text-border/50" />
                <circle cx="30" cy="30" r="24" fill="none" stroke="currentColor" strokeWidth="6"
                  strokeDasharray={`${report.score * 1.508} 150.8`}
                  className={scoreColor(report.score)} strokeLinecap="round" />
              </svg>
              <span className={cn("absolute inset-0 flex items-center justify-center text-sm font-bold", scoreColor(report.score))}>
                {report.score}
              </span>
            </div>
            <div>
              <p className={cn("text-lg font-bold", scoreColor(report.score))}>{scoreLabel(report.score)}</p>
              <p className="text-[12px] text-muted-foreground/70">Total size: {report.totalSizeKB} KB</p>
              <p className="text-[12px] text-muted-foreground/70">{allFiles.length} files analyzed</p>
            </div>
          </div>

          {/* Core Web Vitals risks */}
          <CollapsibleSection id="cwv" label={`Core Web Vitals Risks (${report.cwvRisks.length})`}
            expanded={expandedSection === "cwv"} onToggle={() => setExpandedSection(expandedSection === "cwv" ? null : "cwv")}>
            {report.cwvRisks.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-emerald-400">
                <CheckCircle2 className="size-4" /> No Core Web Vitals risks detected.
              </div>
            ) : report.cwvRisks.map((r, i) => (
              <div key={i} className={cn("mx-4 mb-2 rounded-lg border p-3", RISK_BG[r.riskLevel])}>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-secondary/50 px-1.5 py-0.5 text-[11px] font-mono font-bold">{r.metric}</span>
                  <span className={cn("text-[11px] font-semibold capitalize", RISK_COLOR[r.riskLevel])}>{r.riskLevel} risk</span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground/70 italic">{METRIC_DESC[r.metric]}</p>
                <p className="mt-1 text-[12px]">{r.reason}</p>
                <p className="mt-1 text-[11px] text-emerald-400">→ {r.recommendation}</p>
              </div>
            ))}
          </CollapsibleSection>

          {/* Slow components */}
          <CollapsibleSection id="slow" label={`Slow Components (${report.slowComponents.length})`}
            expanded={expandedSection === "slow"} onToggle={() => setExpandedSection(expandedSection === "slow" ? null : "slow")}>
            {report.slowComponents.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-3 text-[12px] text-emerald-400">
                <CheckCircle2 className="size-4" /> No slow components detected.
              </div>
            ) : report.slowComponents.map((c, i) => (
              <button key={i} type="button" onClick={() => openTab(c.path)}
                className="flex w-full items-start gap-2 px-4 py-2.5 text-left hover:bg-foreground/[0.03]">
                <FileCode className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                <div>
                  <p className="text-[12px] font-medium">{c.name}</p>
                  <p className="text-[11px] text-muted-foreground/60 truncate">{c.path}</p>
                  {c.issues.map((issue, j) => (
                    <p key={j} className="mt-0.5 text-[11px] text-amber-400/80">· {issue}</p>
                  ))}
                </div>
                <span className={cn("ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium capitalize", RISK_COLOR[c.estimatedImpact])}>
                  {c.estimatedImpact}
                </span>
              </button>
            ))}
          </CollapsibleSection>

          {/* Largest files */}
          <CollapsibleSection id="bundle" label={`Largest Files`}
            expanded={expandedSection === "bundle"} onToggle={() => setExpandedSection(expandedSection === "bundle" ? null : "bundle")}>
            {report.largestFiles.map((f, i) => (
              <button key={i} type="button" onClick={() => openTab(f.path)}
                className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-foreground/[0.03]">
                <span className="w-5 text-[11px] text-muted-foreground/40">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px]">{f.path}</p>
                  <div className="mt-0.5 h-1 w-full rounded-full bg-border/40">
                    <div className="h-full rounded-full bg-primary/60"
                      style={{ width: `${Math.min(100, (f.sizeKB / report.largestFiles[0].sizeKB) * 100)}%` }} />
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground/70">{f.sizeKB} KB</span>
              </button>
            ))}
          </CollapsibleSection>

          {/* Missing optimizations */}
          {report.missingOptimizations.length > 0 && (
            <CollapsibleSection id="opts" label={`Missing Optimizations (${report.missingOptimizations.length})`}
              expanded={expandedSection === "opts"} onToggle={() => setExpandedSection(expandedSection === "opts" ? null : "opts")}>
              {report.missingOptimizations.map((opt, i) => (
                <div key={i} className="flex items-start gap-2 px-4 py-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                  <p className="text-[12px]">{opt}</p>
                </div>
              ))}
            </CollapsibleSection>
          )}
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({ id, label, expanded, onToggle, children }: {
  id: string; label: string; expanded: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div>
      <button type="button" onClick={onToggle}
        className="flex w-full items-center gap-2 bg-card/30 px-4 py-2.5 text-left hover:bg-card/50">
        {expanded ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
        <span className="text-[12px] font-medium">{label}</span>
      </button>
      {expanded && <div>{children}</div>}
    </div>
  );
}
