"use client";

// Phase 89 — Global Engineering Intelligence
// Aggregate insights and trend analysis across all repositories.
// Filterable trend reports, cross-repo pattern detection, org-wide signals.

import { useState } from "react";
import { Globe, TrendingUp, TrendingDown, AlertTriangle, GitCommit, Zap, Clock, Users, Search, Filter, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

type TrendCategory = "all" | "velocity" | "quality" | "security" | "performance" | "collaboration";
type TrendDirection = "up" | "down" | "stable";

interface TrendReport {
  id: string;
  category: Exclude<TrendCategory, "all">;
  title: string;
  metric: string;
  value: string;
  delta: string;
  direction: TrendDirection;
  repos: string[];
  insight: string;
  alert?: boolean;
}

interface OrgSignal {
  type: "pattern" | "risk" | "opportunity" | "anomaly";
  title: string;
  body: string;
  repos: string[];
  since: string;
}

const CAT_CONFIG: Record<Exclude<TrendCategory, "all">, { icon: React.ElementType; color: string }> = {
  velocity:      { icon: Zap,           color: "text-primary"           },
  quality:       { icon: GitCommit,     color: "text-emerald-400"       },
  security:      { icon: AlertTriangle, color: "text-red-400"           },
  performance:   { icon: TrendingUp,    color: "text-blue-400"          },
  collaboration: { icon: Users,         color: "text-purple-400"        },
};

const TRENDS: TrendReport[] = [
  {
    id: "1", category: "velocity", title: "Commit frequency dropped", metric: "Commits / week",
    value: "28", delta: "−18%", direction: "down",
    repos: ["aof-web", "tmap-v2"],
    insight: "Commit cadence fell 18% over 2 weeks — likely caused by large feature branches not yet merged.",
    alert: true,
  },
  {
    id: "2", category: "quality", title: "TypeScript error rate at all-time low", metric: "TS errors / kloc",
    value: "0.4", delta: "−60%", direction: "up",
    repos: ["aof-web"],
    insight: "Strict mode enforcement and IDEPanel type extension reduced type errors by 60% this month.",
  },
  {
    id: "3", category: "security", title: "Unrotated API key detected in env config", metric: "Key age (days)",
    value: "47d", delta: "+47d", direction: "down",
    repos: ["tmap-v2"],
    insight: "TMAP_API_KEY has not been rotated in 47 days. Policy requires rotation every 30 days.",
    alert: true,
  },
  {
    id: "4", category: "performance", title: "Bundle size regressed after Phase 81–86", metric: "Initial JS (gzip)",
    value: "218KB", delta: "+24KB", direction: "down",
    repos: ["aof-web"],
    insight: "10 new panel components added without lazy-load caused initial bundle to grow by 24KB.",
    alert: true,
  },
  {
    id: "5", category: "velocity", title: "PR merge time improved", metric: "Avg PR merge (hrs)",
    value: "6.2h", delta: "−34%", direction: "up",
    repos: ["aof-web", "tmap-v2", "coagentix-cli"],
    insight: "AI code review suggestions accepted in 71% of PRs reduced review cycle from 9.4h to 6.2h.",
  },
  {
    id: "6", category: "collaboration", title: "Solo commit ratio high", metric: "Solo commits (%)",
    value: "94%", delta: "+12%", direction: "down",
    repos: ["tmap-v2"],
    insight: "94% of commits are single-author. Consider pair programming sessions or design docs for complex features.",
  },
  {
    id: "7", category: "quality", title: "Test coverage stable", metric: "Coverage (%)",
    value: "68%", delta: "0%", direction: "stable",
    repos: ["aof-web", "tmap-v2"],
    insight: "Coverage held at 68% as new panel components added tests at the same rate as code.",
  },
  {
    id: "8", category: "performance", title: "SSE streaming P99 latency improved", metric: "P99 TTFB (ms)",
    value: "210ms", delta: "−45ms", direction: "up",
    repos: ["tmap-v2"],
    insight: "Chunked response improvements in Phase 73 reduced first-token latency across all AI endpoints.",
  },
];

const ORG_SIGNALS: OrgSignal[] = [
  {
    type: "risk", title: "Feature branch divergence risk",
    body: "3 long-lived feature branches in aof-web have not merged to main in 8+ days. Risk of integration conflict grows daily.",
    repos: ["aof-web"], since: "8d ago",
  },
  {
    type: "pattern", title: "Repeated pattern: missing useEffect cleanup",
    body: "Memory leak pattern (setInterval without cleanup) detected in 4 components. Auto-refactor proposal available.",
    repos: ["aof-web"], since: "3d ago",
  },
  {
    type: "opportunity", title: "Shared SSE reader abstraction opportunity",
    body: "Identical SSE ReadableStream pattern found in 4 API routes. Extracting to lib/sse.ts would save ~80 lines.",
    repos: ["aof-web"], since: "today",
  },
  {
    type: "anomaly", title: "Unusual spike in error logging",
    body: "tmap-v2 error log volume increased 3× on Jun 28. Correlated with knowledge-graph query timeout (INC-001).",
    repos: ["tmap-v2"], since: "2d ago",
  },
];

const SIGNAL_CONFIG = {
  risk:        { color: "text-red-400 border-red-500/20 bg-red-500/5",           label: "Risk"        },
  pattern:     { color: "text-amber-400 border-amber-500/20 bg-amber-500/5",     label: "Pattern"     },
  opportunity: { color: "text-primary border-primary/20 bg-primary/5",           label: "Opportunity" },
  anomaly:     { color: "text-purple-400 border-purple-500/20 bg-purple-500/5",  label: "Anomaly"     },
};

interface GlobalIntelligencePanelProps { className?: string }

export function GlobalIntelligencePanel({ className }: GlobalIntelligencePanelProps) {
  const [category, setCategory] = useState<TrendCategory>("all");
  const [view, setView] = useState<"trends" | "signals">("trends");

  const filtered = TRENDS.filter((t) => category === "all" || t.category === category);
  const alertCount = TRENDS.filter((t) => t.alert).length;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Global Engineering Intelligence</span>
        </div>
        {alertCount > 0 && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] text-red-400">{alertCount} alerts</span>
        )}
      </div>

      <div className="flex items-center justify-between border-b border-border/40 bg-card/20 px-3 py-1.5">
        <div className="flex">
          {(["trends", "signals"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={cn("px-3 py-1.5 text-[11px] font-medium capitalize transition-colors",
                view === v ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>
              {v === "signals" ? `Org Signals (${ORG_SIGNALS.length})` : "Trends"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground/40">
          <Clock className="size-3" /> Updated 5m ago
        </div>
      </div>

      {view === "trends" && (
        <>
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border/30 px-3 py-1.5 no-scrollbar">
            {(["all", "velocity", "quality", "security", "performance", "collaboration"] as TrendCategory[]).map((cat) => (
              <button key={cat} type="button" onClick={() => setCategory(cat)}
                className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize transition-colors",
                  category === cat ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-foreground")}>
                {cat === "all" ? "All" : cat}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filtered.map((trend) => {
              const cfg = CAT_CONFIG[trend.category];
              const Icon = cfg.icon;
              const isUp = trend.direction === "up";
              const isDown = trend.direction === "down";
              return (
                <div key={trend.id} className={cn("rounded-xl border px-3 py-2.5",
                  trend.alert ? "border-amber-500/20 bg-amber-500/5" : "border-border/40 bg-card/30")}>
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <Icon className={cn("size-3.5 shrink-0", cfg.color)} />
                    <span className="font-medium text-foreground flex-1 leading-tight">{trend.title}</span>
                    {trend.alert && <AlertTriangle className="size-3 text-amber-400 shrink-0" />}
                  </div>
                  <div className="flex items-center gap-3 mb-2">
                    <div>
                      <span className="font-mono text-lg font-bold text-foreground">{trend.value}</span>
                      <span className="text-[10px] text-muted-foreground/50 ml-1.5">{trend.metric}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {isUp   && <TrendingUp   className="size-3 text-emerald-400" />}
                      {isDown && <TrendingDown  className="size-3 text-red-400"     />}
                      <span className={cn("text-[10px] font-semibold",
                        isUp ? "text-emerald-400" : isDown ? "text-red-400" : "text-muted-foreground/50")}>{trend.delta}</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 leading-relaxed">{trend.insight}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {trend.repos.map((r) => (
                      <span key={r} className="rounded bg-muted/20 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/50">{r}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {view === "signals" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <p className="text-[10px] text-muted-foreground/40 px-1 pb-1">Cross-repository pattern detection and organizational signals</p>
          {ORG_SIGNALS.map((sig, i) => {
            const cfg = SIGNAL_CONFIG[sig.type];
            return (
              <div key={i} className={cn("rounded-xl border px-3 py-2.5", cfg.color)}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase", cfg.color)}>
                    {cfg.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground/40 ml-auto">{sig.since}</span>
                </div>
                <p className="font-medium text-foreground mb-1 leading-tight">{sig.title}</p>
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">{sig.body}</p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {sig.repos.map((r) => (
                    <span key={r} className="rounded bg-muted/15 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/50">{r}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
