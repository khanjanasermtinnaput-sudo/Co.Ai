"use client";

// Phase 77 — AI Incident Response
// Auto-collect logs → root cause → generate hotfix → create PR → recommend rollback.

import { useState } from "react";
import {
  AlertTriangle, Loader2, CheckCircle, GitPullRequest, RotateCcw,
  FileText, Search, Zap, Activity, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type IncidentStatus = "open" | "investigating" | "mitigated" | "resolved";
type IncidentSeverity = "critical" | "high" | "medium" | "low";

interface Incident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  startedAt: string;
  service: string;
  aiAnalysis?: string;
  rootCause?: string;
  suggestedFix?: string;
  prUrl?: string;
}

const SEV_COLOR: Record<IncidentSeverity, string> = {
  critical: "text-red-400 bg-red-500/15 border-red-500/30",
  high:     "text-amber-400 bg-amber-500/15 border-amber-500/30",
  medium:   "text-yellow-400 bg-yellow-500/15 border-yellow-500/30",
  low:      "text-muted-foreground bg-muted/20 border-border/40",
};

const INCIDENTS: Incident[] = [
  {
    id: "INC-001",
    title: "tmap-v2 response latency spike — P95 > 8s",
    severity: "critical",
    status: "investigating",
    startedAt: "14 min ago",
    service: "tmap-v2",
    aiAnalysis: "Memory pressure detected on replica-1. Redis cache miss rate jumped to 94%. Root cause likely in knowledge-graph build cycle triggered by large repo imports.",
    rootCause: "Unbounded graph build in knowledge-graph.ts:buildGraph() — no max-node limit",
    suggestedFix: "Add MAX_NODES=5000 cap in knowledge-graph.ts line 47. Flush Redis key 'kg:*' to clear stale cache.",
  },
  {
    id: "INC-002",
    title: "Auth token refresh failing for 3% of users",
    severity: "high",
    status: "open",
    startedAt: "2h ago",
    service: "auth-service",
    aiAnalysis: "Supabase token refresh endpoint returning 429 for burst traffic. Exponential backoff not implemented in client.",
  },
  {
    id: "INC-003",
    title: "CDN cache stale on /api/health",
    severity: "low",
    status: "resolved",
    startedAt: "1d ago",
    service: "cloudflare",
  },
];

interface IncidentResponsePanelProps {
  className?: string;
}

export function IncidentResponsePanel({ className }: IncidentResponsePanelProps) {
  const [selected, setSelected] = useState<string>("INC-001");
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState(0);

  const incident = INCIDENTS.find((i) => i.id === selected);

  const PIPELINE_STEPS = [
    "Collecting logs",
    "Analyzing metrics",
    "Tracing commits",
    "Finding root cause",
    "Generating hotfix",
    "Running tests",
    "Creating PR",
    "Ready for review",
  ];

  async function handleInvestigate() {
    setGenerating(true);
    setStep(0);
    for (let i = 0; i <= PIPELINE_STEPS.length - 1; i++) {
      await new Promise((r) => setTimeout(r, 600));
      setStep(i + 1);
    }
    setGenerating(false);
  }

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-red-400" />
          <span className="font-semibold text-foreground">Incident Response</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            {INCIDENTS.filter((i) => i.status !== "resolved").length} OPEN
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Incident list */}
        <div className="w-36 shrink-0 border-r border-border/40 overflow-y-auto">
          {INCIDENTS.map((inc) => (
            <button
              key={inc.id}
              type="button"
              onClick={() => { setSelected(inc.id); setStep(0); }}
              className={cn(
                "w-full border-b border-border/30 px-2.5 py-2.5 text-left transition-colors",
                selected === inc.id ? "bg-primary/10" : "hover:bg-white/5",
              )}
            >
              <p className="font-mono text-[10px] font-semibold text-muted-foreground/60">{inc.id}</p>
              <p className="text-[11px] text-foreground leading-tight mt-0.5 line-clamp-2">{inc.title}</p>
              <div className="mt-1 flex items-center gap-1">
                <span className={cn("rounded px-1 py-0.5 text-[8px] font-semibold uppercase border", SEV_COLOR[inc.severity])}>
                  {inc.severity}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Incident detail */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {incident && (
            <>
              <div>
                <div className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase mb-2", SEV_COLOR[incident.severity])}>
                  <AlertTriangle className="size-2.5" />
                  {incident.severity}
                </div>
                <p className="font-semibold text-foreground leading-tight">{incident.title}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-1 flex items-center gap-1">
                  <Clock className="size-2.5" />
                  {incident.startedAt} · {incident.service}
                </p>
              </div>

              {/* AI Analysis */}
              {incident.aiAnalysis && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                  <p className="font-medium text-amber-400 flex items-center gap-1.5 mb-1.5">
                    <Search className="size-3" /> AI Analysis
                  </p>
                  <p className="text-muted-foreground/80 leading-relaxed">{incident.aiAnalysis}</p>
                </div>
              )}

              {/* Root Cause */}
              {incident.rootCause && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2.5">
                  <p className="font-medium text-red-400 flex items-center gap-1.5 mb-1.5">
                    <Zap className="size-3" /> Root Cause
                  </p>
                  <p className="font-mono text-[11px] text-red-800/80 dark:text-red-300/80">{incident.rootCause}</p>
                </div>
              )}

              {/* Suggested Fix */}
              {incident.suggestedFix && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                  <p className="font-medium text-emerald-400 flex items-center gap-1.5 mb-1.5">
                    <FileText className="size-3" /> Suggested Fix
                  </p>
                  <p className="text-muted-foreground/80 leading-relaxed">{incident.suggestedFix}</p>
                </div>
              )}

              {/* Investigation pipeline */}
              {(generating || step > 0) && (
                <div className="rounded-xl border border-border/40 bg-card/30 px-3 py-3">
                  <p className="font-medium text-foreground mb-2.5 flex items-center gap-1.5">
                    <Activity className="size-3.5 text-primary" /> AI Investigation Pipeline
                  </p>
                  <div className="space-y-1.5">
                    {PIPELINE_STEPS.map((s, i) => {
                      const done = i < step;
                      const active = i === step - 1 && generating;
                      return (
                        <div key={s} className="flex items-center gap-2">
                          {done && !active ? (
                            <CheckCircle className="size-3 shrink-0 text-emerald-400" />
                          ) : active ? (
                            <Loader2 className="size-3 shrink-0 text-primary animate-spin" />
                          ) : (
                            <div className="size-3 shrink-0 rounded-full border border-border/50" />
                          )}
                          <span className={cn("text-[11px]", done ? "text-foreground/70" : active ? "text-primary" : "text-muted-foreground/40")}>
                            {s}
                          </span>
                          {done && <span className="ml-auto text-[9px] text-emerald-400/60">done</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-1.5">
                {incident.status !== "resolved" && (
                  <Button
                    className="w-full h-8 text-[11px] gap-1.5"
                    onClick={handleInvestigate}
                    disabled={generating}
                  >
                    {generating ? <Loader2 className="size-3 animate-spin" /> : <Search className="size-3" />}
                    {generating ? "Investigating…" : "Investigate with AI"}
                  </Button>
                )}
                {step >= PIPELINE_STEPS.length && (
                  <>
                    <Button variant="outline" className="w-full h-8 text-[11px] gap-1.5">
                      <GitPullRequest className="size-3" /> Open Hotfix PR
                    </Button>
                    <Button variant="ghost" className="w-full h-8 text-[11px] gap-1.5 text-muted-foreground">
                      <RotateCcw className="size-3" /> Rollback to v1.4.2
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
