"use client";

// Phase 90 — Engineering Operating System Core
// The foundation: modular core services that orchestrate all other systems.
// Real-time health, throughput, version, and dependency map for each service.

import { useState } from "react";
import { Cpu, CheckCircle, AlertTriangle, X, RefreshCw, Loader2, Zap, GitMerge, Database, Shield, BarChart3, Package2, Globe, TestTube, Layers, Brain, Route, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ServiceStatus = "healthy" | "degraded" | "down" | "starting";

interface CoreService {
  id: string;
  name: string;
  version: string;
  status: ServiceStatus;
  icon: React.ElementType;
  role: string;
  uptime: string;
  latencyMs: number;
  throughputRps: number;
  deps: string[];
  layer: "orchestration" | "runtime" | "intelligence" | "infrastructure";
}

const LAYER_CONFIG: Record<CoreService["layer"], { label: string; color: string }> = {
  orchestration:  { label: "Orchestration",  color: "text-primary bg-primary/10 border-primary/20"           },
  runtime:        { label: "Runtime",        color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  intelligence:   { label: "Intelligence",   color: "text-purple-400 bg-purple-500/10 border-purple-500/20"   },
  infrastructure: { label: "Infrastructure", color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20"         },
};

const STATUS_CONFIG: Record<ServiceStatus, { icon: React.ElementType; color: string; label: string }> = {
  healthy:  { icon: CheckCircle,  color: "text-emerald-400", label: "Healthy"   },
  degraded: { icon: AlertTriangle,color: "text-amber-400",   label: "Degraded"  },
  down:     { icon: X,            color: "text-red-400",     label: "Down"      },
  starting: { icon: Loader2,      color: "text-blue-400",    label: "Starting…" },
};

const CORE_SERVICES: CoreService[] = [
  {
    id: "orchestrator", name: "AI Orchestrator", version: "3.2.1", status: "healthy",
    icon: Brain, role: "Routes tasks to the optimal agent. Manages agent lifecycle, retries, and fan-out.",
    uptime: "99.97%", latencyMs: 8, throughputRps: 420,
    deps: ["model-router", "agent-runtime", "memory-engine"],
    layer: "orchestration",
  },
  {
    id: "workflow-engine", name: "Workflow Engine", version: "2.1.0", status: "healthy",
    icon: Route, role: "Executes multi-step workflows with conditional branching, parallel execution, and human gates.",
    uptime: "99.94%", latencyMs: 12, throughputRps: 95,
    deps: ["orchestrator", "repo-intel"],
    layer: "orchestration",
  },
  {
    id: "agent-runtime", name: "Agent Runtime", version: "4.0.2", status: "degraded",
    icon: Zap, role: "Sandboxed execution environment for AI agents. Enforces capability scoping and tool permissions.",
    uptime: "99.12%", latencyMs: 48, throughputRps: 180,
    deps: ["model-router", "security-engine"],
    layer: "runtime",
  },
  {
    id: "repo-intel", name: "Repository Intelligence", version: "1.8.0", status: "healthy",
    icon: GitMerge, role: "Real-time codebase indexing: AST parsing, symbol graph, dependency tree, change detection.",
    uptime: "99.99%", latencyMs: 22, throughputRps: 310,
    deps: ["knowledge-graph"],
    layer: "intelligence",
  },
  {
    id: "knowledge-graph", name: "Knowledge Graph", version: "2.5.3", status: "healthy",
    icon: Layers, role: "Semantic graph of codebase entities, docs, decisions, and their relationships.",
    uptime: "99.80%", latencyMs: 18, throughputRps: 280,
    deps: ["memory-engine"],
    layer: "intelligence",
  },
  {
    id: "memory-engine", name: "Memory Engine", version: "1.4.0", status: "healthy",
    icon: Database, role: "Persistent cross-session memory: learned patterns, user preferences, validated solutions.",
    uptime: "99.95%", latencyMs: 6, throughputRps: 520,
    deps: [],
    layer: "infrastructure",
  },
  {
    id: "diff-engine", name: "Diff Engine", version: "1.2.1", status: "healthy",
    icon: GitMerge, role: "Semantic diff generation, merge conflict detection, and AI-assisted resolution.",
    uptime: "99.98%", latencyMs: 15, throughputRps: 140,
    deps: ["repo-intel"],
    layer: "runtime",
  },
  {
    id: "testing-engine", name: "Testing Engine", version: "2.0.0", status: "healthy",
    icon: TestTube, role: "AI test generation, coverage analysis, and flaky test detection across all frameworks.",
    uptime: "99.88%", latencyMs: 35, throughputRps: 60,
    deps: ["agent-runtime", "repo-intel"],
    layer: "runtime",
  },
  {
    id: "deploy-engine", name: "Deployment Engine", version: "1.5.2", status: "healthy",
    icon: Globe, role: "Manages deployment pipelines, rollback triggers, canary releases, and health checks.",
    uptime: "99.93%", latencyMs: 28, throughputRps: 20,
    deps: ["workflow-engine"],
    layer: "infrastructure",
  },
  {
    id: "monitoring-engine", name: "Monitoring Engine", version: "1.3.0", status: "healthy",
    icon: Activity, role: "Aggregates metrics, logs, traces across all services. Feeds anomaly detection.",
    uptime: "100%", latencyMs: 4, throughputRps: 1200,
    deps: [],
    layer: "infrastructure",
  },
  {
    id: "analytics-engine", name: "Analytics Engine", version: "1.1.0", status: "healthy",
    icon: BarChart3, role: "Business metrics aggregation: DAU, MRR, feature-level conversion, velocity trends.",
    uptime: "99.90%", latencyMs: 40, throughputRps: 85,
    deps: ["monitoring-engine"],
    layer: "intelligence",
  },
  {
    id: "plugin-runtime", name: "Plugin Runtime", version: "0.9.1", status: "starting",
    icon: Package2, role: "Sandboxed marketplace extension execution. Permission gating, resource limits, hot-reload.",
    uptime: "—", latencyMs: 0, throughputRps: 0,
    deps: ["agent-runtime", "security-engine"],
    layer: "runtime",
  },
  {
    id: "model-router", name: "Model Router", version: "2.3.0", status: "healthy",
    icon: Route, role: "Selects optimal LLM per task type (code, analysis, vision, function-call) with fallback chain.",
    uptime: "99.99%", latencyMs: 3, throughputRps: 680,
    deps: [],
    layer: "orchestration",
  },
  {
    id: "security-engine", name: "Security Engine", version: "1.6.0", status: "healthy",
    icon: Shield, role: "RBAC enforcement, API key rotation, secrets audit, OWASP scan, compliance policy engine.",
    uptime: "100%", latencyMs: 7, throughputRps: 920,
    deps: [],
    layer: "infrastructure",
  },
];

const LAYER_ORDER: CoreService["layer"][] = ["orchestration", "runtime", "intelligence", "infrastructure"];

interface EngineeringOSPanelProps { className?: string }

export function EngineeringOSPanel({ className }: EngineeringOSPanelProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);

  async function handleRestart(id: string) {
    setRestarting(id);
    await new Promise((r) => setTimeout(r, 2000));
    setRestarting(null);
  }

  const selectedSvc = CORE_SERVICES.find((s) => s.id === selected);
  const degradedCount = CORE_SERVICES.filter((s) => s.status === "degraded" || s.status === "down").length;
  const healthyCount  = CORE_SERVICES.filter((s) => s.status === "healthy").length;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Engineering OS Core</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-emerald-400">{healthyCount} healthy</span>
          {degradedCount > 0 && <span className="text-amber-400">{degradedCount} degraded</span>}
        </div>
      </div>

      {degradedCount > 0 && (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2">
          <AlertTriangle className="size-3 text-amber-400 shrink-0" />
          <span className="text-[11px] text-amber-400/90">{degradedCount} core service{degradedCount !== 1 ? "s" : ""} require attention</span>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className={cn("overflow-y-auto p-3 space-y-4", selected ? "w-52 shrink-0 border-r border-border/40" : "flex-1")}>
          {LAYER_ORDER.map((layer) => {
            const layerSvcs = CORE_SERVICES.filter((s) => s.layer === layer);
            const cfg = LAYER_CONFIG[layer];
            return (
              <div key={layer}>
                <div className={cn("mb-2 flex items-center gap-1.5 rounded-full border px-2 py-0.5 w-fit text-[10px] font-semibold", cfg.color)}>
                  {cfg.label}
                </div>
                <div className="space-y-1.5">
                  {layerSvcs.map((svc) => {
                    const Icon = svc.icon;
                    const stCfg = STATUS_CONFIG[svc.status];
                    const StIcon = stCfg.icon;
                    const isRestarting = restarting === svc.id;
                    return (
                      <button
                        key={svc.id}
                        type="button"
                        onClick={() => setSelected(selected === svc.id ? null : svc.id)}
                        className={cn("w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                          selected === svc.id ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card/30 hover:bg-card/50")}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="size-3.5 text-muted-foreground/60 shrink-0" />
                          <span className="flex-1 font-medium text-foreground truncate">{svc.name}</span>
                          {isRestarting
                            ? <Loader2 className="size-3 text-blue-400 animate-spin shrink-0" />
                            : <StIcon className={cn("size-3 shrink-0", stCfg.color, svc.status === "starting" && "animate-spin")} />
                          }
                        </div>
                        {!selected && (
                          <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/50">
                            <span className="font-mono">{svc.version}</span>
                            <span>{svc.uptime}</span>
                            {svc.latencyMs > 0 && <span>{svc.latencyMs}ms</span>}
                            {svc.throughputRps > 0 && <span>{svc.throughputRps} rps</span>}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {selected && selectedSvc && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <selectedSvc.icon className="size-4 text-muted-foreground/60" />
                  <p className="font-semibold text-foreground">{selectedSvc.name}</p>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className="font-mono text-muted-foreground/50">v{selectedSvc.version}</span>
                  <span className={cn("font-medium", STATUS_CONFIG[selectedSvc.status].color)}>{STATUS_CONFIG[selectedSvc.status].label}</span>
                </div>
              </div>
              {(selectedSvc.status === "degraded" || selectedSvc.status === "down") && (
                <Button size="sm" variant="outline" className="h-7 gap-1.5 shrink-0 text-[10px]"
                  onClick={() => handleRestart(selectedSvc.id)} disabled={restarting === selectedSvc.id}>
                  <RefreshCw className={cn("size-3", restarting === selectedSvc.id && "animate-spin")} />
                  Restart
                </Button>
              )}
            </div>

            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{selectedSvc.role}</p>

            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Uptime",      value: selectedSvc.uptime || "—"           },
                { label: "Latency",     value: selectedSvc.latencyMs ? `${selectedSvc.latencyMs}ms` : "—" },
                { label: "Throughput",  value: selectedSvc.throughputRps ? `${selectedSvc.throughputRps} rps` : "—" },
                { label: "Layer",       value: LAYER_CONFIG[selectedSvc.layer].label },
              ].map((m) => (
                <div key={m.label} className="rounded-xl border border-border/40 bg-card/30 px-3 py-2">
                  <p className="text-[9px] text-muted-foreground/40 mb-0.5">{m.label}</p>
                  <p className="font-mono text-[12px] font-medium text-foreground">{m.value}</p>
                </div>
              ))}
            </div>

            {selectedSvc.deps.length > 0 && (
              <div className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5">
                <p className="text-[10px] font-semibold text-muted-foreground/50 mb-2">Service Dependencies</p>
                <div className="space-y-1">
                  {selectedSvc.deps.map((dep) => {
                    const depSvc = CORE_SERVICES.find((s) => s.id === dep);
                    const depCfg = depSvc ? STATUS_CONFIG[depSvc.status] : null;
                    const DepIcon = depCfg?.icon ?? CheckCircle;
                    return (
                      <div key={dep} className="flex items-center gap-2 text-[10px]">
                        {depCfg ? <DepIcon className={cn("size-3 shrink-0", depCfg.color)} /> : null}
                        <span className="text-foreground/70">{depSvc?.name ?? dep}</span>
                        {depSvc && <span className="ml-auto text-muted-foreground/40 font-mono">v{depSvc.version}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedSvc.status === "degraded" && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                <p className="font-medium text-amber-400 mb-1 text-[11px]">Service Degraded</p>
                <p className="text-[10px] text-amber-400/70">Agent Runtime is experiencing elevated latency (48ms vs 15ms baseline). Likely cause: tool-use timeout spike. No data loss. Auto-recovery in progress.</p>
              </div>
            )}

            {selectedSvc.status === "starting" && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2.5">
                <p className="font-medium text-blue-400 mb-1 text-[11px]">Starting Up</p>
                <p className="text-[10px] text-blue-400/70">Plugin Runtime is initializing. Sandbox environment warming up. Will be available in ~30s.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
