"use client";

// Phase 84 — Autonomous Refactoring Engine
// Continuous audit: finds duplication, dead code, large files, circular deps, leaks.
// Every proposal includes benefit, risk, migration plan, and diff preview.
// No automatic refactoring without developer approval.

import { useState } from "react";
import { Wand2, AlertCircle, CheckCircle, X, ChevronRight, Loader2, FileCode, Zap, Package2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type RefactorType = "duplication" | "dead-code" | "large-file" | "circular-dep" | "legacy-api" | "memory-leak" | "bundle-inflation" | "slow-component";
type RiskLevel = "low" | "medium" | "high";

interface RefactorProposal {
  id: string;
  type: RefactorType;
  title: string;
  file: string;
  estimatedBenefit: string;
  riskLevel: RiskLevel;
  effort: string;
  description: string;
  diff?: string;
  status: "pending" | "approved" | "rejected" | "applied";
}

const TYPE_CONFIG: Record<RefactorType, { label: string; icon: React.ElementType; color: string }> = {
  duplication:     { label: "Duplication",       icon: RefreshCw,  color: "text-amber-400 bg-amber-500/10"  },
  "dead-code":     { label: "Dead Code",         icon: X,          color: "text-red-400 bg-red-500/10"      },
  "large-file":    { label: "Large File",        icon: FileCode,   color: "text-orange-400 bg-orange-500/10"},
  "circular-dep":  { label: "Circular Dep",      icon: RefreshCw,  color: "text-purple-400 bg-purple-500/10"},
  "legacy-api":    { label: "Legacy API",        icon: AlertCircle,color: "text-yellow-400 bg-yellow-500/10"},
  "memory-leak":   { label: "Memory Leak",       icon: AlertCircle,color: "text-red-400 bg-red-500/10"      },
  "bundle-inflation":{ label: "Bundle Inflation",icon: Package2,   color: "text-blue-400 bg-blue-500/10"    },
  "slow-component":{ label: "Slow Component",    icon: Zap,        color: "text-muted-foreground bg-muted/20"},
};

const RISK_COLOR: Record<RiskLevel, string> = {
  low: "text-emerald-400", medium: "text-amber-400", high: "text-red-400",
};

const PROPOSALS: RefactorProposal[] = [
  {
    id: "1", type: "large-file", title: "Split cocode-ide-store.ts into domain stores",
    file: "src/store/cocode-ide-store.ts", estimatedBenefit: "Bundle −12%, faster HMR", riskLevel: "medium", effort: "~4h",
    status: "pending",
    description: "847-line store handles FS, tabs, GitHub, diff, workflow, checkpoints. Split into 6 domain stores: fs-store, tab-store, github-store, diff-store, workflow-store, checkpoint-store.",
    diff: `--- a/src/store/cocode-ide-store.ts\n+++ b/src/store/cocode-ide-store.ts\n@@ -1,847 +1,120 @@\n-// All state in one file\n+// Delegates to domain stores\n+export * from "./fs-store";\n+export * from "./tab-store";\n+// ... etc`,
  },
  {
    id: "2", type: "duplication", title: "Extract shared SSE reader into lib/sse.ts",
    file: "src/app/api/chat/route.ts", estimatedBenefit: "−80 lines DRY, easier testing", riskLevel: "low", effort: "~1h",
    status: "pending",
    description: "SSE ReadableStream pattern copied in 4 API routes. Extract to shared lib/sse.ts createSSEStream helper.",
    diff: `--- /dev/null\n+++ b/src/lib/sse.ts\n+export function createSSEStream(fn: (send) => Promise<void>): Response { ... }`,
  },
  {
    id: "3", type: "dead-code", title: "Remove 3 unused exports from code-store.ts",
    file: "src/store/code-store.ts", estimatedBenefit: "Cleaner tree-shaking", riskLevel: "low", effort: "~15min",
    status: "pending",
    description: "coarseMode, legacyBrief, and oldSend exports have 0 references across the codebase. Safe to remove.",
    diff: `--- a/src/store/code-store.ts\n+++ b/src/store/code-store.ts\n-export const coarseMode = ...\n-export const legacyBrief = ...\n-export const oldSend = ...`,
  },
  {
    id: "4", type: "bundle-inflation", title: "Lazy-load lucide-react icon subsets per panel",
    file: "src/components/cocode/cocode-ide.tsx", estimatedBenefit: "Initial bundle −18KB", riskLevel: "low", effort: "~2h",
    status: "pending",
    description: "cocode-ide.tsx imports 40+ lucide icons upfront. Dynamic import per panel reduces initial JS parse time.",
  },
  {
    id: "5", type: "memory-leak", title: "Fix useEffect missing cleanup in WorkflowIndicator",
    file: "src/components/cocode/workflow-indicator.tsx", estimatedBenefit: "Prevent leak on unmount", riskLevel: "medium", effort: "~30min",
    status: "approved",
    description: "setInterval in WorkflowIndicator lacks clearInterval in useEffect cleanup. Causes timer to run after component unmounts.",
    diff: `--- a/src/components/cocode/workflow-indicator.tsx\n+++ b/src/components/cocode/workflow-indicator.tsx\n-useEffect(() => {\n-  setInterval(tick, 1000);\n-}, []);\n+useEffect(() => {\n+  const id = setInterval(tick, 1000);\n+  return () => clearInterval(id);\n+}, []);`,
  },
];

interface AutoRefactorPanelProps { className?: string }

export function AutoRefactorPanel({ className }: AutoRefactorPanelProps) {
  const [proposals, setProposals] = useState(PROPOSALS);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  async function handleScan() {
    setScanning(true);
    await new Promise((r) => setTimeout(r, 2200));
    setScanning(false);
  }

  function approve(id: string) {
    setProposals((prev) => prev.map((p) => p.id === id ? { ...p, status: "approved" as const } : p));
  }
  function reject(id: string) {
    setProposals((prev) => prev.map((p) => p.id === id ? { ...p, status: "rejected" as const } : p));
  }

  const pending  = proposals.filter((p) => p.status === "pending");
  const approved = proposals.filter((p) => p.status === "approved");
  const rejected = proposals.filter((p) => p.status === "rejected");

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Wand2 className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Autonomous Refactor</span>
          {pending.length > 0 && (
            <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">{pending.length} pending</span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={handleScan} disabled={scanning} className="h-6 px-2 text-[10px] gap-1">
          {scanning ? <Loader2 className="size-3 animate-spin" /> : <Wand2 className="size-3" />}
          {scanning ? "Scanning…" : "Scan"}
        </Button>
      </div>

      <div className="flex items-center justify-between border-b border-border/30 bg-card/10 px-4 py-2 text-[10px]">
        <span className="text-muted-foreground/60">No automatic changes — every proposal requires your approval</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {approved.length > 0 && (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/60 px-1 pb-0.5">Approved</p>
            {approved.map((p) => (
              <div key={p.id} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle className="size-3.5 text-emerald-400 shrink-0" />
                  <span className="font-medium text-foreground/80">{p.title}</span>
                </div>
              </div>
            ))}
            <div className="h-px bg-border/30 my-1" />
          </>
        )}

        {pending.length > 0 && (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/60 px-1 pb-0.5">Awaiting Review</p>
            {pending.map((p) => {
              const cfg = TYPE_CONFIG[p.type];
              const Icon = cfg.icon;
              const isExpanded = expanded === p.id;
              return (
                <div key={p.id} className="rounded-xl border border-border/40 bg-card/30 hover:bg-card/50 transition-colors overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : p.id)}
                    className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left"
                  >
                    <div className={cn("mt-0.5 rounded-md p-1 shrink-0", cfg.color)}>
                      <Icon className="size-3" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground leading-tight">{p.title}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px]">
                        <span className="font-mono text-muted-foreground/50 truncate">{p.file.split("/").pop()}</span>
                        <span className="text-primary/70">{p.estimatedBenefit}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn("text-[9px] font-semibold", RISK_COLOR[p.riskLevel])}>{p.riskLevel} risk</span>
                      <ChevronRight className={cn("size-3.5 text-muted-foreground/40 transition-transform", isExpanded && "rotate-90")} />
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border/30 px-3 py-3 space-y-2.5">
                      <p className="text-muted-foreground/80 leading-relaxed">{p.description}</p>
                      <div className="flex items-center gap-3 text-[10px]">
                        <span className="text-muted-foreground/50">Effort: <span className="text-foreground/70">{p.effort}</span></span>
                        <span className="text-muted-foreground/50">Risk: <span className={RISK_COLOR[p.riskLevel]}>{p.riskLevel}</span></span>
                      </div>
                      {p.diff && (
                        <pre className="rounded-lg border border-border/30 bg-black/30 p-2.5 font-mono text-[10px] text-muted-foreground/70 overflow-x-auto whitespace-pre">{p.diff}</pre>
                      )}
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" className="h-7 px-3 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-500" onClick={() => approve(p.id)}>
                          <CheckCircle className="size-3" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 px-3 text-[11px] gap-1 text-red-400 border-red-500/30 hover:bg-red-500/10" onClick={() => reject(p.id)}>
                          <X className="size-3" /> Reject
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {rejected.length > 0 && (
          <>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/30 px-1 pb-0.5 mt-2">Rejected</p>
            {rejected.map((p) => (
              <div key={p.id} className="rounded-xl border border-border/30 bg-card/20 px-3 py-2 opacity-50">
                <span className="text-muted-foreground/60">{p.title}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
