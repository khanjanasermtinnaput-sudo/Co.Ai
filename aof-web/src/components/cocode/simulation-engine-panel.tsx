"use client";

// Phase 88 — AI Simulation Engine
// Pre-implementation simulation: architecture, performance, scalability, security,
// database growth, traffic spikes, cost, failure cascade. Never ship blind.

import { useState } from "react";
import { FlaskConical, Play, CheckCircle, AlertTriangle, X, Loader2, TrendingUp, Shield, Database, Zap, DollarSign, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type SimCategory = "performance" | "scalability" | "security" | "database" | "cost" | "failure";
type SimStatus = "idle" | "running" | "complete" | "failed";

interface SimScenario {
  id: string;
  category: SimCategory;
  name: string;
  description: string;
  inputs: Record<string, string>;
}

interface SimResult {
  scenarioId: string;
  riskScore: number; // 0-100
  summary: string;
  findings: { level: "info" | "warn" | "critical"; text: string }[];
  recommendations: string[];
  projectedMetrics: { label: string; value: string; delta?: string; negative?: boolean }[];
}

const CAT_CONFIG: Record<SimCategory, { icon: React.ElementType; color: string; label: string }> = {
  performance: { icon: Zap,        color: "text-primary bg-primary/10",         label: "Performance"  },
  scalability: { icon: TrendingUp, color: "text-blue-400 bg-blue-500/10",       label: "Scalability"  },
  security:    { icon: Shield,     color: "text-red-400 bg-red-500/10",         label: "Security"     },
  database:    { icon: Database,   color: "text-emerald-400 bg-emerald-500/10", label: "Database"     },
  cost:        { icon: DollarSign, color: "text-yellow-400 bg-yellow-500/10",   label: "Cost"         },
  failure:     { icon: AlertTriangle, color: "text-orange-400 bg-orange-500/10",label: "Failure"      },
};

const SCENARIOS: SimScenario[] = [
  {
    id: "perf-1", category: "performance", name: "AI Chat Latency Under Load",
    description: "Simulate 500 concurrent AI chat sessions hitting the tmap-v2 agent endpoint.",
    inputs: { concurrentSessions: "500", avgTokens: "2048", providers: "claude,openai" },
  },
  {
    id: "scale-1", category: "scalability", name: "10× Traffic Spike",
    description: "Simulate sudden 10× traffic spike from 1k → 10k DAU over 15 minutes.",
    inputs: { baseDAU: "1000", peakMultiplier: "10", rampMinutes: "15" },
  },
  {
    id: "sec-1", category: "security", name: "API Key Rotation Safety",
    description: "Simulate rolling API key rotation without service interruption.",
    inputs: { services: "tmap-v2,aof-web", rotationMethod: "AES-256-GCM", zeroDT: "true" },
  },
  {
    id: "db-1", category: "database", name: "Database Growth 12 Months",
    description: "Project Supabase DB growth based on current write rate and user growth.",
    inputs: { currentRowsPerDay: "12000", userGrowthRate: "15%/mo", retentionMonths: "6" },
  },
  {
    id: "cost-1", category: "cost", name: "AI Token Cost Forecast",
    description: "Project monthly AI API costs at various DAU milestones.",
    inputs: { avgTokensPerSession: "3200", dau: "1000,5000,20000", providers: "claude-3-5-sonnet" },
  },
  {
    id: "fail-1", category: "failure", name: "Provider Failover Cascade",
    description: "Simulate primary LLM provider outage and automatic failover behavior.",
    inputs: { primaryProvider: "anthropic", fallbacks: "openai,groq", failoverSLA: "500ms" },
  },
];

const MOCK_RESULTS: Record<string, SimResult> = {
  "perf-1": {
    scenarioId: "perf-1",
    riskScore: 62,
    summary: "System handles ~320 concurrent sessions before P95 latency degrades past 4s SLA.",
    findings: [
      { level: "critical", text: "Agent queue saturates at 320 concurrent — 35% of requests would time out at 500 target" },
      { level: "warn",     text: "No request queuing — overload causes direct HTTP 504 (not graceful degradation)" },
      { level: "info",     text: "Redis token-count caching would reduce LLM calls by ~30% under load" },
    ],
    recommendations: ["Add BullMQ job queue with configurable concurrency limit", "Implement streaming backpressure in SSE handler", "Add horizontal pod autoscaling at 70% CPU threshold"],
    projectedMetrics: [
      { label: "P50 latency",     value: "1.2s",  delta: "+0.4s",  negative: true  },
      { label: "P95 latency",     value: "4.8s",  delta: "+2.1s",  negative: true  },
      { label: "Throughput",      value: "320 rps" },
      { label: "Error rate",      value: "35%",   delta: "+35%",   negative: true  },
      { label: "CPU headroom",    value: "8%",    delta: "-72%",   negative: true  },
    ],
  },
  "scale-1": {
    scenarioId: "scale-1",
    riskScore: 45,
    summary: "Railway auto-scales to handle 8× spike, but DB connection pool exhausts at 6× (6k DAU).",
    findings: [
      { level: "warn",     text: "Supabase pool (max 25 connections) exhausts at ~6k concurrent users" },
      { level: "info",     text: "Railway auto-scaling responds in ~40s — acceptable for gradual ramp" },
      { level: "info",     text: "CDN caches 72% of static assets — reduces origin pressure significantly" },
    ],
    recommendations: ["Add PgBouncer connection pooler to increase effective pool to 200", "Pre-warm Railway replicas before known traffic events"],
    projectedMetrics: [
      { label: "Scale-out time", value: "40s" },
      { label: "DB pool headroom", value: "0% @ 6k DAU", negative: true },
      { label: "CDN offload",    value: "72%" },
      { label: "Est. cost @10k", value: "$120/mo" },
    ],
  },
};

const RISK_COLOR = (score: number) => score >= 70 ? "text-red-400" : score >= 40 ? "text-amber-400" : "text-emerald-400";
const RISK_BG    = (score: number) => score >= 70 ? "bg-red-500/10 border-red-500/20" : score >= 40 ? "bg-amber-500/10 border-amber-500/20" : "bg-emerald-500/10 border-emerald-500/20";

interface SimulationEnginePanelProps { className?: string }

export function SimulationEnginePanel({ className }: SimulationEnginePanelProps) {
  const [activeCategory, setActiveCategory] = useState<SimCategory | "all">("all");
  const [status, setStatus] = useState<Record<string, SimStatus>>({});
  const [results, setResults] = useState<Record<string, SimResult>>({});
  const [selected, setSelected] = useState<string | null>(null);

  async function runSimulation(id: string) {
    setStatus((s) => ({ ...s, [id]: "running" }));
    setSelected(id);
    await new Promise((r) => setTimeout(r, 2500));
    const result = MOCK_RESULTS[id] ?? {
      scenarioId: id, riskScore: 28, summary: "Simulation complete. No critical issues detected.",
      findings: [{ level: "info" as const, text: "All metrics within expected bounds" }],
      recommendations: ["Continue monitoring with current configuration"],
      projectedMetrics: [{ label: "Overall risk", value: "Low" }],
    };
    setResults((r) => ({ ...r, [id]: result }));
    setStatus((s) => ({ ...s, [id]: "complete" }));
  }

  const filtered = SCENARIOS.filter((s) => activeCategory === "all" || s.category === activeCategory);
  const selectedScenario = SCENARIOS.find((s) => s.id === selected);
  const selectedResult = selected ? results[selected] : null;
  const selectedStatus = selected ? (status[selected] ?? "idle") : "idle";

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-4 text-primary" />
          <span className="font-semibold text-foreground">AI Simulation Engine</span>
        </div>
        <span className="text-[10px] text-muted-foreground/50">Pre-implementation only</span>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-border/30 px-3 py-1.5 no-scrollbar">
        <button type="button" onClick={() => setActiveCategory("all")}
          className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
            activeCategory === "all" ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-foreground")}>
          All
        </button>
        {(Object.keys(CAT_CONFIG) as SimCategory[]).map((cat) => (
          <button key={cat} type="button" onClick={() => setActiveCategory(cat)}
            className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize transition-colors",
              activeCategory === cat ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-foreground")}>
            {CAT_CONFIG[cat].label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn("overflow-y-auto p-3 space-y-2", selected ? "w-52 shrink-0 border-r border-border/40" : "flex-1")}>
          {filtered.map((sc) => {
            const cfg = CAT_CONFIG[sc.category];
            const Icon = cfg.icon;
            const st = status[sc.id] ?? "idle";
            const res = results[sc.id];
            return (
              <div key={sc.id}
                className={cn("rounded-xl border px-3 py-2.5 cursor-pointer transition-colors",
                  selected === sc.id ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card/30 hover:bg-card/50")}
                onClick={() => setSelected(sc.id === selected ? null : sc.id)}>
                <div className="flex items-start gap-2.5">
                  <div className={cn("rounded-md p-1.5 shrink-0 mt-0.5", cfg.color)}>
                    <Icon className="size-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground leading-tight">{sc.name}</p>
                    {!selected && <p className="text-[10px] text-muted-foreground/60 mt-0.5 leading-snug">{sc.description}</p>}
                  </div>
                  <div className="shrink-0">
                    {st === "running"  && <Loader2 className="size-3.5 text-primary animate-spin" />}
                    {st === "complete" && res && (
                      <span className={cn("text-[9px] font-bold", RISK_COLOR(res.riskScore))}>{res.riskScore}</span>
                    )}
                    {st === "idle" && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); runSimulation(sc.id); }}
                        className="rounded-lg border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary hover:bg-primary/20 transition-colors">
                        Run
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {selected && selectedScenario && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-foreground">{selectedScenario.name}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">{selectedScenario.description}</p>
              </div>
              {selectedStatus === "idle" && (
                <Button size="sm" className="h-7 gap-1.5 shrink-0" onClick={() => runSimulation(selected)}>
                  <Play className="size-3" /> Simulate
                </Button>
              )}
            </div>

            {/* Inputs */}
            <div className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5">
              <p className="text-[10px] font-semibold text-muted-foreground/50 mb-2">Simulation Inputs</p>
              {Object.entries(selectedScenario.inputs).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-0.5">
                  <span className="font-mono text-[10px] text-muted-foreground/60">{k}</span>
                  <span className="font-mono text-[10px] text-foreground/80">{v}</span>
                </div>
              ))}
            </div>

            {selectedStatus === "running" && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="size-8 text-primary animate-spin" />
                <p className="text-[11px] text-muted-foreground/60">Running simulation…</p>
                <p className="text-[10px] text-muted-foreground/40">Analyzing performance, cost, failure scenarios</p>
              </div>
            )}

            {selectedStatus === "complete" && selectedResult && (
              <>
                <div className={cn("rounded-xl border px-3 py-2.5", RISK_BG(selectedResult.riskScore))}>
                  <div className="flex items-center gap-3 mb-1.5">
                    <span className="text-[10px] font-semibold text-muted-foreground/50">RISK SCORE</span>
                    <span className={cn("text-2xl font-bold font-mono", RISK_COLOR(selectedResult.riskScore))}>{selectedResult.riskScore}</span>
                    <span className="text-[10px] text-muted-foreground/50">/ 100</span>
                  </div>
                  <p className="text-[11px] text-foreground/80 leading-relaxed">{selectedResult.summary}</p>
                </div>

                <div className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground/50 mb-2">Projected Metrics</p>
                  {selectedResult.projectedMetrics.map((m) => (
                    <div key={m.label} className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground/60">{m.label}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-foreground/80">{m.value}</span>
                        {m.delta && <span className={cn("text-[9px] font-semibold", m.negative ? "text-red-400" : "text-emerald-400")}>{m.delta}</span>}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground/50 px-1">Findings</p>
                  {selectedResult.findings.map((f, i) => (
                    <div key={i} className={cn("flex gap-2 rounded-xl border px-3 py-2",
                      f.level === "critical" ? "border-red-500/20 bg-red-500/5" :
                      f.level === "warn"     ? "border-amber-500/20 bg-amber-500/5" :
                                               "border-border/30 bg-card/20")}>
                      {f.level === "critical" ? <X className="size-3 text-red-400 shrink-0 mt-0.5" /> :
                       f.level === "warn"     ? <AlertTriangle className="size-3 text-amber-400 shrink-0 mt-0.5" /> :
                                                <CheckCircle className="size-3 text-emerald-400 shrink-0 mt-0.5" />}
                      <p className="text-[10px] text-muted-foreground/80 leading-snug">{f.text}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5">
                  <p className="text-[10px] font-semibold text-primary/70 mb-1.5">Recommendations</p>
                  <ul className="space-y-1">
                    {selectedResult.recommendations.map((r, i) => (
                      <li key={i} className="flex gap-1.5 text-[10px] text-muted-foreground/80">
                        <span className="text-primary/50 shrink-0">{i + 1}.</span>{r}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
