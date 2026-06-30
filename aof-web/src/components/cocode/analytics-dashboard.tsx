"use client";

// Phase 74 — Intelligent Engineering Analytics
// Lead time, cycle time, deployment frequency, bug rate, technical debt.

import { BarChart3, TrendingUp, TrendingDown, Minus, Clock, Zap, Bug, GitMerge, Code2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface Metric {
  label: string;
  value: string;
  trend: "up" | "down" | "stable";
  delta: string;
  good: "up" | "down"; // which direction is good
  icon: React.ElementType;
}

const METRICS: Metric[] = [
  { label: "Lead Time",          value: "2.4d",  trend: "down",   delta: "↓18%", good: "down", icon: Clock      },
  { label: "Cycle Time",         value: "1.1d",  trend: "down",   delta: "↓9%",  good: "down", icon: Zap        },
  { label: "Deploy Frequency",   value: "3/day", trend: "up",     delta: "↑25%", good: "up",   icon: GitMerge   },
  { label: "Bug Rate",           value: "0.8%",  trend: "down",   delta: "↓40%", good: "down", icon: Bug        },
  { label: "Review Time",        value: "3.2h",  trend: "stable", delta: "→0%",  good: "down", icon: Clock      },
  { label: "Code Churn",         value: "12%",   trend: "down",   delta: "↓6%",  good: "down", icon: Code2      },
  { label: "Tech Debt Ratio",    value: "8.4%",  trend: "up",     delta: "↑2%",  good: "down", icon: ShieldAlert},
  { label: "Perf Score",         value: "94",    trend: "up",     delta: "↑3pt", good: "up",   icon: TrendingUp },
];

const SPARKLINES: Record<string, number[]> = {
  "Lead Time":        [3.8, 3.2, 2.9, 2.7, 2.5, 2.4],
  "Deploy Frequency": [1.5, 1.8, 2.2, 2.6, 2.8, 3.0],
  "Bug Rate":         [2.1, 1.9, 1.6, 1.3, 1.0, 0.8],
  "Perf Score":       [88,  89,  90,  91,  93,  94 ],
};

function Sparkline({ data, good }: { data: number[]; good: "up" | "down" }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 24;
  const w = 60;
  const step = w / (data.length - 1);

  const points = data.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");

  const lastBetter = good === "up" ? data[data.length - 1] > data[0] : data[data.length - 1] < data[0];
  const color = lastBetter ? "#10b981" : "#f87171";

  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  );
}

interface AnalyticsDashboardProps {
  className?: string;
}

export function AnalyticsDashboard({ className }: AnalyticsDashboardProps) {
  function trendColor(m: Metric): string {
    if (m.trend === "stable") return "text-muted-foreground/60";
    const isGood = m.trend === m.good;
    return isGood ? "text-emerald-400" : "text-red-400";
  }

  const TrendIcon = (trend: Metric["trend"]) =>
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Engineering Analytics</span>
        </div>
        <span className="text-[10px] text-muted-foreground/50">Last 30 days</span>
      </div>

      {/* Risk prediction banner */}
      <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2">
        <ShieldAlert className="size-3 text-amber-400 shrink-0" />
        <span className="text-[11px] text-amber-400/90">AI predicts tech debt will exceed 10% in ~3 weeks without intervention</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* Metrics grid */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {METRICS.map((m) => {
            const Icon = m.icon;
            const TIcon = TrendIcon(m.trend);
            const sparkData = SPARKLINES[m.label];
            return (
              <div key={m.label} className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 hover:bg-card/50 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <Icon className="size-3.5 text-muted-foreground/60" />
                  <div className={cn("flex items-center gap-0.5 text-[10px] font-medium", trendColor(m))}>
                    <TIcon className="size-2.5" />
                    {m.delta}
                  </div>
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-lg font-bold text-foreground leading-none">{m.value}</p>
                    <p className="text-[9px] text-muted-foreground/60 mt-0.5">{m.label}</p>
                  </div>
                  {sparkData && <Sparkline data={sparkData} good={m.good} />}
                </div>
              </div>
            );
          })}
        </div>

        {/* Risk forecast */}
        <div className="rounded-xl border border-border/40 bg-card/30 px-4 py-3">
          <p className="font-medium text-foreground mb-3 flex items-center gap-2">
            <TrendingUp className="size-3.5 text-primary" /> 30-Day Risk Forecast
          </p>
          <div className="space-y-2">
            {[
              { label: "Security Risk",    pct: 22, color: "bg-red-500"   },
              { label: "Performance Risk", pct: 15, color: "bg-amber-500" },
              { label: "Tech Debt Risk",   pct: 61, color: "bg-orange-500"},
              { label: "Test Coverage",    pct: 78, color: "bg-emerald-500"},
            ].map((r) => (
              <div key={r.label}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-muted-foreground/70">{r.label}</span>
                  <span className="text-[10px] text-muted-foreground/60">{r.pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-border/30 overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", r.color)} style={{ width: `${r.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
