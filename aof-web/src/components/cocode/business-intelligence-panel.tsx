"use client";

// Phase 78 — AI Business Intelligence
// Feature usage, user behavior, conversion impact, revenue impact, engineering priorities.

import { TrendingUp, TrendingDown, Users, DollarSign, MousePointer, Zap, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FeatureMetric {
  feature: string;
  dau: number;
  dauTrend: number;
  conversionImpact: number;
  revenueImpact: string;
  priority: "must-have" | "should-have" | "nice-to-have";
  aiNote: string;
}

const FEATURES: FeatureMetric[] = [
  {
    feature: "CoCode",
    dau: 1840,
    dauTrend: +28,
    conversionImpact: +12,
    revenueImpact: "+$4,200/mo",
    priority: "must-have",
    aiNote: "Highest activation feature — users who try CoCode convert to PRO 3× more",
  },
  {
    feature: "AI Chat",
    dau: 5210,
    dauTrend: +8,
    conversionImpact: +6,
    revenueImpact: "+$1,800/mo",
    priority: "must-have",
    aiNote: "Core retention driver. Users chat daily churn 4× less.",
  },
  {
    feature: "Deployment Panel",
    dau: 420,
    dauTrend: -5,
    conversionImpact: +9,
    revenueImpact: "+$950/mo",
    priority: "should-have",
    aiNote: "Low usage but high intent signal. Users who deploy once rarely churn.",
  },
  {
    feature: "GitHub Integration",
    dau: 1120,
    dauTrend: +14,
    conversionImpact: +7,
    revenueImpact: "+$1,400/mo",
    priority: "must-have",
    aiNote: "Sticky feature — teams connecting GitHub have 2× session length.",
  },
  {
    feature: "AI Review Panel",
    dau: 290,
    dauTrend: +42,
    conversionImpact: +4,
    revenueImpact: "+$580/mo",
    priority: "nice-to-have",
    aiNote: "Fast-growing. Watch closely — may become must-have in Q2.",
  },
];

const PRIORITY_COLOR = {
  "must-have":    "text-emerald-400 bg-emerald-500/10",
  "should-have":  "text-blue-400 bg-blue-500/10",
  "nice-to-have": "text-muted-foreground bg-muted/20",
};

interface BusinessIntelligencePanelProps {
  className?: string;
}

export function BusinessIntelligencePanel({ className }: BusinessIntelligencePanelProps) {
  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Business Intelligence</span>
        </div>
        <span className="text-[10px] text-muted-foreground/50">Last 30 days</span>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 border-b border-border/40">
        {[
          { label: "Total DAU", value: "8.9k", delta: "+18%", good: true, icon: Users },
          { label: "MRR Impact", value: "$8.9k", delta: "+$1.2k", good: true, icon: DollarSign },
          { label: "Conversion", value: "6.4%", delta: "+0.8pp", good: true, icon: MousePointer },
        ].map((kpi) => {
          const Icon = kpi.icon;
          return (
            <div key={kpi.label} className="flex flex-col items-center gap-0.5 border-r last:border-r-0 border-border/40 py-2.5">
              <Icon className="size-3.5 text-primary" />
              <p className="text-base font-bold text-foreground">{kpi.value}</p>
              <p className="text-[9px] text-muted-foreground/60">{kpi.label}</p>
              <span className="text-[9px] text-emerald-400 flex items-center gap-0.5">
                <TrendingUp className="size-2.5" />{kpi.delta}
              </span>
            </div>
          );
        })}
      </div>

      {/* AI Priority insight */}
      <div className="border-b border-primary/20 bg-primary/5 px-4 py-2.5">
        <p className="font-medium text-primary flex items-center gap-1.5 mb-1">
          <Zap className="size-3" /> AI Priority Recommendation
        </p>
        <p className="text-[11px] text-muted-foreground/80">
          Focus engineering on <strong className="text-foreground">CoCode workspace performance</strong> and <strong className="text-foreground">GitHub sync reliability</strong> — highest ROI per engineering day based on conversion and churn data.
        </p>
      </div>

      {/* Feature table */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-1 pb-1">Feature Business Impact</p>
        {FEATURES.map((f) => (
          <div key={f.feature} className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 hover:bg-card/50 transition-colors">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-medium text-foreground">{f.feature}</span>
              <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold", PRIORITY_COLOR[f.priority])}>
                {f.priority}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[10px] mb-2">
              <div>
                <p className="text-muted-foreground/50">DAU</p>
                <div className="flex items-center gap-0.5 font-medium text-foreground/80">
                  {f.dau.toLocaleString()}
                  <span className={cn("ml-1", f.dauTrend > 0 ? "text-emerald-400" : "text-red-400")}>
                    {f.dauTrend > 0 ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-muted-foreground/50">Conv. Impact</p>
                <p className="font-medium text-emerald-400">+{f.conversionImpact}%</p>
              </div>
              <div>
                <p className="text-muted-foreground/50">Revenue</p>
                <p className="font-medium text-emerald-400">{f.revenueImpact}</p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/60 italic">{f.aiNote}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
