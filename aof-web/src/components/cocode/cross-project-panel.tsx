"use client";

// Phase 87 — Cross-Project Intelligence
// Understands relationships between frontend, backend, SDK, mobile, docs, infra.
// Generates impact analysis before any modification.

import { useState } from "react";
import { GitMerge, AlertTriangle, ArrowRight, CheckCircle, Search, Layers, Link, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ProjectType = "frontend" | "backend" | "sdk" | "mobile" | "docs" | "infra";

interface Project {
  id: string;
  name: string;
  type: ProjectType;
  path: string;
  status: "healthy" | "warning" | "affected";
  dependsOn: string[];
  exposedAPIs: string[];
  sharedModels: string[];
}

interface ImpactItem {
  project: string;
  file: string;
  change: string;
  risk: "none" | "low" | "medium" | "high";
  reason: string;
}

const TYPE_COLOR: Record<ProjectType, string> = {
  frontend: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  backend:  "text-primary bg-primary/10 border-primary/30",
  sdk:      "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  mobile:   "text-purple-400 bg-purple-500/10 border-purple-500/30",
  docs:     "text-muted-foreground bg-muted/15 border-border/30",
  infra:    "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
};

const PROJECTS: Project[] = [
  {
    id: "aof-web", name: "aof-web", type: "frontend", path: "aof-web/",
    status: "healthy", dependsOn: ["tmap-v2"],
    exposedAPIs: [], sharedModels: ["ChatMessageT", "UserTier", "RouteDecision"],
  },
  {
    id: "tmap-v2", name: "tmap-v2", type: "backend", path: "tmap-v2/",
    status: "warning", dependsOn: [],
    exposedAPIs: ["/v1/chat", "/v1/agents/chief", "/v1/agents/run", "/v1/health"],
    sharedModels: ["AgentResult", "ChiefDecision", "WorkflowStep"],
  },
  {
    id: "coagentix-cli", name: "coagentix-cli", type: "sdk", path: "coagentix-cli/",
    status: "healthy", dependsOn: ["tmap-v2"],
    exposedAPIs: [], sharedModels: ["ChatMessageT"],
  },
  {
    id: "docs", name: "Documentation", type: "docs", path: "docs/",
    status: "affected", dependsOn: ["aof-web", "tmap-v2"],
    exposedAPIs: [], sharedModels: [],
  },
  {
    id: "infra", name: "Infrastructure", type: "infra", path: "railway.toml / render.yaml",
    status: "healthy", dependsOn: ["tmap-v2"],
    exposedAPIs: [], sharedModels: [],
  },
];

const IMPACT_ANALYSIS: ImpactItem[] = [
  { project: "tmap-v2", file: "src/routes/chat.ts",     change: "Rename /v1/chat → /v1/stream",      risk: "high",   reason: "aof-web hardcodes /api/chat → /v1/chat proxy. Breaking change." },
  { project: "tmap-v2", file: "src/types/agent.ts",     change: "Add field to AgentResult",           risk: "low",    reason: "coagentix-cli reads AgentResult — additive change, backwards-compatible." },
  { project: "aof-web", file: "src/lib/types.ts",       change: "Add UserTier.ENTERPRISE",            risk: "medium", reason: "tmap-v2 validates tier server-side — must be added there too." },
  { project: "aof-web", file: "src/store/ui-store.ts",  change: "Add developerMode state",            risk: "none",   reason: "Frontend-only state. No cross-project impact." },
];

const RISK_COLOR = { none: "text-emerald-400", low: "text-blue-400", medium: "text-amber-400", high: "text-red-400" };
const RISK_BG    = { none: "bg-emerald-500/5 border-emerald-500/20", low: "bg-blue-500/5 border-blue-500/20", medium: "bg-amber-500/5 border-amber-500/20", high: "bg-red-500/5 border-red-500/20" };

interface CrossProjectPanelProps { className?: string }

export function CrossProjectPanel({ className }: CrossProjectPanelProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "impact">("graph");

  const selectedProject = PROJECTS.find((p) => p.id === selected);
  const highRisk = IMPACT_ANALYSIS.filter((i) => i.risk === "high");

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Cross-Project Intelligence</span>
        </div>
        <div className="flex rounded-lg border border-border/40 overflow-hidden">
          {(["graph", "impact"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={cn("px-2 py-1 text-[10px] font-medium capitalize transition-colors",
                view === v ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}>
              {v === "graph" ? "Projects" : "Impact"}
            </button>
          ))}
        </div>
      </div>

      {highRisk.length > 0 && (
        <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/5 px-4 py-2">
          <AlertTriangle className="size-3 text-red-400 shrink-0" />
          <span className="text-[11px] text-red-400/90">{highRisk.length} pending change{highRisk.length !== 1 ? "s" : ""} with cross-project breaking impact</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {view === "graph" && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-1 pb-1">Project Dependency Graph</p>

            {/* Simple vertical dependency flow */}
            <div className="space-y-1">
              {PROJECTS.map((proj, i) => {
                const deps = PROJECTS.filter((p) => proj.dependsOn.includes(p.id));
                return (
                  <div key={proj.id}>
                    {i > 0 && proj.dependsOn.length > 0 && (
                      <div className="flex justify-center py-0.5">
                        <ArrowRight className="size-3 text-border/50 rotate-90" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelected(selected === proj.id ? null : proj.id)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                        selected === proj.id ? "border-primary/50 bg-primary/8" : cn(TYPE_COLOR[proj.type], "hover:opacity-80"),
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className={cn("size-1.5 rounded-full shrink-0",
                          proj.status === "healthy" ? "bg-emerald-500" : proj.status === "warning" ? "bg-amber-500" : "bg-red-500")} />
                        <span className="font-mono font-medium text-foreground">{proj.name}</span>
                        <span className="text-[9px] text-muted-foreground/50 capitalize">{proj.type}</span>
                        {proj.status !== "healthy" && (
                          <span className={cn("ml-auto text-[9px] font-semibold capitalize",
                            proj.status === "warning" ? "text-amber-400" : "text-red-400")}>{proj.status}</span>
                        )}
                      </div>
                      {selected === proj.id && (
                        <div className="mt-2 pt-2 border-t border-border/30 space-y-1.5">
                          {proj.exposedAPIs.length > 0 && (
                            <div>
                              <p className="text-[9px] text-muted-foreground/50 mb-1">Exposed APIs</p>
                              {proj.exposedAPIs.map((api) => (
                                <p key={api} className="font-mono text-[10px] text-emerald-400/70">{api}</p>
                              ))}
                            </div>
                          )}
                          {proj.sharedModels.length > 0 && (
                            <div>
                              <p className="text-[9px] text-muted-foreground/50 mb-1">Shared Models</p>
                              <div className="flex flex-wrap gap-1">
                                {proj.sharedModels.map((m) => (
                                  <span key={m} className="rounded bg-muted/20 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/70">{m}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          {proj.dependsOn.length > 0 && (
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
                              <Link className="size-3" />
                              Depends on: {proj.dependsOn.join(", ")}
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {view === "impact" && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-1 pb-1">Pending Change Impact Analysis</p>
            {IMPACT_ANALYSIS.map((item, i) => (
              <div key={i} className={cn("rounded-xl border px-3 py-2.5", RISK_BG[item.risk])}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={cn("text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 border", RISK_COLOR[item.risk], RISK_BG[item.risk])}>
                    {item.risk} risk
                  </span>
                  <span className="font-mono text-[11px] text-foreground/80 font-medium">{item.project}</span>
                </div>
                <p className="text-[10px] font-mono text-muted-foreground/50 mb-1">{item.file}</p>
                <p className="text-[11px] font-medium text-foreground/80 mb-1">{item.change}</p>
                <p className="text-[10px] text-muted-foreground/60 leading-relaxed">{item.reason}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
