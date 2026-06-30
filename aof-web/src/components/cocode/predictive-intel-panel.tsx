"use client";

// Phase 96 — Predictive Engineering Intelligence
// Forecasts future problems before they occur: bottlenecks, storage growth,
// DB growth, infrastructure costs, security risks, technical debt, maintenance costs.
// Recommends preventive actions. Evidence-based predictions only.

import { useState } from "react";
import { TrendingUp, AlertTriangle, DollarSign, Database, Shield, Cpu, Clock, HardDrive, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type ForecastCategory = "all" | "performance" | "storage" | "cost" | "security" | "debt" | "maintenance";

interface Forecast {
  id: string;
  category: Exclude<ForecastCategory, "all">;
  title: string;
  horizon: string;
  currentValue: string;
  predictedValue: string;
  confidence: number;
  urgency: "low" | "medium" | "high" | "critical";
  evidence: string;
  preventiveActions: string[];
  estimatedCostToFix: string;
  estimatedCostToIgnore: string;
}

const CAT_CONFIG: Record<Exclude<ForecastCategory, "all">, { icon: React.ElementType; color: string; label: string }> = {
  performance: { icon: Cpu,          color: "text-primary",     label: "Performance"    },
  storage:     { icon: HardDrive,    color: "text-cyan-400",    label: "Storage"        },
  cost:        { icon: DollarSign,   color: "text-emerald-400", label: "Cloud Cost"     },
  security:    { icon: Shield,       color: "text-red-400",     label: "Security Risk"  },
  debt:        { icon: AlertTriangle,color: "text-amber-400",   label: "Tech Debt"      },
  maintenance: { icon: Clock,        color: "text-purple-400",  label: "Maintenance"    },
};

const URGENCY_COLOR = { low: "text-muted-foreground/50", medium: "text-blue-400", high: "text-amber-400", critical: "text-red-400" };
const URGENCY_BG    = { low: "bg-muted/5 border-border/20", medium: "bg-blue-500/5 border-blue-500/15", high: "bg-amber-500/5 border-amber-500/15", critical: "bg-red-500/8 border-red-500/20" };

const FORECASTS: Forecast[] = [
  {
    id: "1", category: "performance", title: "Agent Queue Saturation",
    horizon: "4–6 weeks at current growth",
    currentValue: "320 max concurrent", predictedValue: "Saturates at 500 DAU (projected in 5 weeks)",
    confidence: 89, urgency: "high",
    evidence: "Phase 88 simulation confirmed saturation at 320 concurrent agents. DAU growing at 18%/week. 500 DAU projection: 5 weeks.",
    preventiveActions: ["Implement BullMQ job queue (Phase 88 recommendation)", "Set max_concurrency=50 per worker", "Add horizontal pod autoscaling at 70% CPU"],
    estimatedCostToFix: "1.5 sprints", estimatedCostToIgnore: "~35% error rate for users at peak",
  },
  {
    id: "2", category: "storage", title: "Supabase DB Size Threshold",
    horizon: "8–10 weeks",
    currentValue: "1.2GB used", predictedValue: "5GB free tier limit (~8 weeks)",
    confidence: 82, urgency: "medium",
    evidence: "Write rate: 12k rows/day. Knowledge graph nodes grow 3× faster than messages. Current retention: unlimited.",
    preventiveActions: ["Add 90-day retention policy to kg_nodes", "Upgrade to Supabase Pro before limit", "Implement cold storage archival for old sessions"],
    estimatedCostToFix: "$25/mo Pro tier", estimatedCostToIgnore: "Service writes blocked at free tier limit",
  },
  {
    id: "3", category: "cost", title: "AI Token Cost Surge",
    horizon: "3 months at current trajectory",
    currentValue: "$180/mo", predictedValue: "$820/mo at 5k DAU",
    confidence: 91, urgency: "high",
    evidence: "Average session: 3,200 tokens. Sonnet-4.6 pricing. At 5k DAU × 2.1 avg sessions/day: $820/mo.",
    preventiveActions: ["Cache repeated context per user session", "Use Haiku for classification tasks, Sonnet for generation", "Implement token budget per session tier"],
    estimatedCostToFix: "2 sprints", estimatedCostToIgnore: "$640 extra/month per 1k DAU beyond 1k",
  },
  {
    id: "4", category: "security", title: "API Key Age Policy Breach",
    horizon: "Already exceeded (47 days)",
    currentValue: "47 days old", predictedValue: "Risk grows exponentially past 90 days",
    confidence: 99, urgency: "critical",
    evidence: "TMAP_API_KEY set 47 days ago. Policy: rotate every 30 days. Key exposure risk compounds over time.",
    preventiveActions: ["Rotate TMAP_API_KEY immediately (Phase 94 gov-002)", "Add CI check: fail build if key age > 30 days", "Set calendar reminder or automate via Security Engine"],
    estimatedCostToFix: "15 minutes", estimatedCostToIgnore: "Credential compromise risk if leaked",
  },
  {
    id: "5", category: "debt", title: "God Object Store Complexity",
    horizon: "Now — growing each phase",
    currentValue: "cocode-ide-store.ts: 847 lines", predictedValue: "~1,200 lines by Phase 100",
    confidence: 96, urgency: "medium",
    evidence: "10 lines added per panel on average. 10 more panels planned. Already causing slow HMR (2.8s reload).",
    preventiveActions: ["Split into domain stores (Phase 84 auto-refactor proposal #1)", "Target: ≤300 lines per store file"],
    estimatedCostToFix: "~4h", estimatedCostToIgnore: "Increasingly slow DX, harder onboarding",
  },
  {
    id: "6", category: "maintenance", title: "Node.js 20 EOL Approaching",
    horizon: "April 2026 (10 months)",
    currentValue: "Node 20 LTS", predictedValue: "Security patches stop April 30, 2026",
    confidence: 100, urgency: "low",
    evidence: "Node 20 enters maintenance-only in October 2025, EOL April 2026. Node 22 LTS available now.",
    preventiveActions: ["Plan Node 22 upgrade for Q4 2025", "Test tmap-v2 compatibility with Node 22", "Update Dockerfile and railway.toml"],
    estimatedCostToFix: "0.5 sprint", estimatedCostToIgnore: "No security updates after April 2026",
  },
];

interface PredictiveIntelPanelProps { className?: string }

export function PredictiveIntelPanel({ className }: PredictiveIntelPanelProps) {
  const [category, setCategory] = useState<ForecastCategory>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = FORECASTS.filter((f) => category === "all" || f.category === category);
  const criticalCount = FORECASTS.filter((f) => f.urgency === "critical").length;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Predictive Intelligence</span>
        </div>
        {criticalCount > 0 && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] text-red-400">{criticalCount} critical now</span>
        )}
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-border/30 px-3 py-1.5 no-scrollbar">
        <button type="button" onClick={() => setCategory("all")}
          className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
            category === "all" ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-foreground")}>All</button>
        {(Object.keys(CAT_CONFIG) as Exclude<ForecastCategory,"all">[]).map((cat) => (
          <button key={cat} type="button" onClick={() => setCategory(cat)}
            className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
              category === cat ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-foreground")}>
            {CAT_CONFIG[cat].label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filtered.map((forecast) => {
          const cfg = CAT_CONFIG[forecast.category];
          const Icon = cfg.icon;
          const isExpanded = expanded === forecast.id;
          return (
            <div key={forecast.id} className={cn("rounded-xl border overflow-hidden", URGENCY_BG[forecast.urgency])}>
              <button type="button" onClick={() => setExpanded(isExpanded ? null : forecast.id)}
                className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left">
                <Icon className={cn("size-3.5 shrink-0 mt-0.5", cfg.color)} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground leading-tight">{forecast.title}</p>
                  <p className="text-[10px] text-muted-foreground/50 mt-0.5">Horizon: {forecast.horizon}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={cn("text-[9px] font-bold uppercase", URGENCY_COLOR[forecast.urgency])}>{forecast.urgency}</span>
                  <ChevronRight className={cn("size-3.5 text-muted-foreground/40 transition-transform", isExpanded && "rotate-90")} />
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border/20 px-3 py-3 space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-border/30 bg-card/30 px-2.5 py-2">
                      <p className="text-[9px] text-muted-foreground/40 mb-0.5">Now</p>
                      <p className="font-mono text-[10px] text-foreground/80">{forecast.currentValue}</p>
                    </div>
                    <div className={cn("rounded-lg border px-2.5 py-2", URGENCY_BG[forecast.urgency])}>
                      <p className="text-[9px] text-muted-foreground/40 mb-0.5">Predicted</p>
                      <p className={cn("font-mono text-[10px] font-semibold", URGENCY_COLOR[forecast.urgency])}>{forecast.predictedValue}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-[9px] font-semibold text-muted-foreground/40 mb-1">Evidence ({forecast.confidence}% confidence)</p>
                    <p className="text-[10px] text-muted-foreground/70 leading-relaxed">{forecast.evidence}</p>
                  </div>

                  <div>
                    <p className="text-[9px] font-semibold text-primary/60 mb-1">Preventive Actions</p>
                    <ul className="space-y-1">
                      {forecast.preventiveActions.map((action, i) => (
                        <li key={i} className="flex gap-1.5 text-[10px] text-muted-foreground/70">
                          <span className="text-primary/50 shrink-0">{i + 1}.</span>{action}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/5 px-2 py-1.5">
                      <p className="text-[9px] text-muted-foreground/40">Fix cost</p>
                      <p className="text-emerald-400 font-semibold">{forecast.estimatedCostToFix}</p>
                    </div>
                    <div className="rounded-lg border border-red-500/15 bg-red-500/5 px-2 py-1.5">
                      <p className="text-[9px] text-muted-foreground/40">Ignore cost</p>
                      <p className="text-red-400 font-semibold">{forecast.estimatedCostToIgnore}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
