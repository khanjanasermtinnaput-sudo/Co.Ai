"use client";

// Phase 81 — Self-Improving AI Engine
// Every completed task becomes a validated lesson. AI never repeats previous mistakes.

import { useState } from "react";
import { Brain, CheckCircle, XCircle, TrendingUp, BookOpen, RefreshCw, Loader2, Zap, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type LessonCategory = "pattern" | "mistake" | "preference" | "security" | "performance";

interface Lesson {
  id: string;
  category: LessonCategory;
  title: string;
  source: string;
  impact: "high" | "medium" | "low";
  validated: boolean;
  appliedCount: number;
  addedAt: string;
}

interface LearningMetric {
  label: string;
  value: string;
  delta: string;
  positive: boolean;
}

const LESSONS: Lesson[] = [
  { id: "1", category: "mistake",     title: "Never use unbounded graph builds — always cap MAX_NODES",        source: "INC-001 post-mortem",         impact: "high",   validated: true,  appliedCount: 7,  addedAt: "2d ago" },
  { id: "2", category: "pattern",     title: "Sliding-window rate limiting outperforms fixed-window at burst", source: "devops-panel analysis",       impact: "high",   validated: true,  appliedCount: 3,  addedAt: "3d ago" },
  { id: "3", category: "preference",  title: "User prefers git push after every phase completion",            source: "Developer feedback",          impact: "medium", validated: true,  appliedCount: 12, addedAt: "1w ago" },
  { id: "4", category: "security",    title: "Rotate JWT secrets every 90 days — add expiry check on boot",   source: "governance audit",            impact: "high",   validated: true,  appliedCount: 2,  addedAt: "4d ago" },
  { id: "5", category: "performance", title: "Monaco editor lazy-loads must use .then(m=>({default:m.X}))",   source: "bundle analysis",             impact: "medium", validated: true,  appliedCount: 18, addedAt: "1w ago" },
  { id: "6", category: "pattern",     title: "Zustand selectors prevent unnecessary re-renders at scale",     source: "perf-profiler report",        impact: "medium", validated: true,  appliedCount: 9,  addedAt: "5d ago" },
  { id: "7", category: "mistake",     title: "tests IDEPanel id was missing — always validate union types",   source: "tsc error TS2353",            impact: "low",    validated: true,  appliedCount: 1,  addedAt: "1d ago" },
];

const METRICS: LearningMetric[] = [
  { label: "Lessons Stored",    value: "247",   delta: "+12 this week",  positive: true  },
  { label: "Mistakes Avoided",  value: "38",    delta: "+5 this sprint", positive: true  },
  { label: "Patterns Reused",   value: "91",    delta: "+14%",           positive: true  },
  { label: "AI Error Rate",     value: "1.2%",  delta: "↓0.4%",         positive: true  },
];

const CAT_CONFIG: Record<LessonCategory, { label: string; color: string; icon: React.ElementType }> = {
  pattern:     { label: "Pattern",     color: "text-blue-400 bg-blue-500/10",    icon: BookOpen    },
  mistake:     { label: "Mistake",     color: "text-red-400 bg-red-500/10",      icon: XCircle     },
  preference:  { label: "Preference",  color: "text-primary bg-primary/10",      icon: CheckCircle },
  security:    { label: "Security",    color: "text-amber-400 bg-amber-500/10",  icon: ShieldCheck },
  performance: { label: "Performance", color: "text-purple-400 bg-purple-500/10",icon: Zap         },
};

const IMPACT_COLOR = { high: "text-red-400", medium: "text-amber-400", low: "text-muted-foreground/60" };

interface SelfImprovingPanelProps { className?: string }

export function SelfImprovingPanel({ className }: SelfImprovingPanelProps) {
  const [activeFilter, setActiveFilter] = useState<LessonCategory | "all">("all");
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<"lessons" | "loop" | "metrics">("lessons");

  async function handleSync() {
    setSyncing(true);
    await new Promise((r) => setTimeout(r, 1800));
    setSyncing(false);
  }

  const filtered = activeFilter === "all" ? LESSONS : LESSONS.filter((l) => l.category === activeFilter);

  const LOOP_STEPS = [
    { label: "Task completed",          done: true  },
    { label: "Evaluate result",         done: true  },
    { label: "Extract lessons",         done: true  },
    { label: "Validate against tests",  done: true  },
    { label: "Update knowledge memory", done: true  },
    { label: "Apply in future tasks",   done: false },
  ];

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Self-Improving AI</span>
        </div>
        <Button size="sm" variant="ghost" onClick={handleSync} disabled={syncing} className="h-6 px-2 text-[10px] gap-1">
          {syncing ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
          Sync
        </Button>
      </div>

      <div className="flex border-b border-border/40 bg-card/20">
        {(["lessons", "loop", "metrics"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={cn("flex-1 py-2 text-[11px] font-medium capitalize transition-colors",
              tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>
            {t === "lessons" ? "Lessons" : t === "loop" ? "Learning Loop" : "Metrics"}
          </button>
        ))}
      </div>

      {tab === "lessons" && (
        <>
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border/30 bg-card/10 px-3 py-1.5 no-scrollbar">
            {(["all", "pattern", "mistake", "preference", "security", "performance"] as const).map((f) => (
              <button key={f} type="button" onClick={() => setActiveFilter(f)}
                className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize transition-colors",
                  activeFilter === f ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-foreground")}>
                {f}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filtered.map((lesson) => {
              const cfg = CAT_CONFIG[lesson.category];
              const Icon = cfg.icon;
              return (
                <div key={lesson.id} className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 hover:bg-card/50 transition-colors">
                  <div className="flex items-start gap-2 mb-1.5">
                    <div className={cn("mt-0.5 rounded p-1", cfg.color)}>
                      <Icon className="size-3 shrink-0" />
                    </div>
                    <p className="flex-1 text-foreground/90 leading-snug font-medium">{lesson.title}</p>
                  </div>
                  <div className="flex items-center gap-2 pl-7 text-[10px]">
                    <span className="text-muted-foreground/50">{lesson.source}</span>
                    <span className={cn("ml-auto font-semibold", IMPACT_COLOR[lesson.impact])}>{lesson.impact}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-emerald-400/70">used {lesson.appliedCount}×</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="text-muted-foreground/40">{lesson.addedAt}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === "loop" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-center">
            <Brain className="size-8 text-primary/60 mx-auto mb-2" />
            <p className="font-semibold text-foreground">Continuous Improvement Loop</p>
            <p className="text-[11px] text-muted-foreground/60 mt-1">Running after every approved task</p>
          </div>
          <div className="space-y-2">
            {LOOP_STEPS.map((step, i) => (
              <div key={step.label} className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/30 px-3 py-2.5">
                <div className={cn("size-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                  step.done ? "bg-emerald-500/20 text-emerald-400" : "bg-border/30 text-muted-foreground/40")}>
                  {step.done ? <CheckCircle className="size-3.5" /> : i + 1}
                </div>
                <span className={cn("font-medium", step.done ? "text-foreground/80" : "text-muted-foreground/40")}>{step.label}</span>
                {step.done && <TrendingUp className="ml-auto size-3 text-emerald-400/60" />}
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
            <p className="text-[11px] text-amber-400/80 font-medium mb-1">Safeguards</p>
            <ul className="space-y-0.5 text-[10px] text-muted-foreground/70">
              <li>· Never overwrite developer preferences</li>
              <li>· Never modify architecture without approval</li>
              <li>· Only validated patterns are stored</li>
            </ul>
          </div>
        </div>
      )}

      {tab === "metrics" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {METRICS.map((m) => (
              <div key={m.label} className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 text-center">
                <p className="text-xl font-bold text-foreground">{m.value}</p>
                <p className="text-[9px] text-muted-foreground/60 mt-0.5">{m.label}</p>
                <p className={cn("text-[10px] mt-1 font-medium", m.positive ? "text-emerald-400" : "text-red-400")}>{m.delta}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-border/40 bg-card/30 px-4 py-3">
            <p className="font-medium text-foreground mb-2 flex items-center gap-2">
              <Brain className="size-3.5 text-primary" /> AI Accuracy Trend (30d)
            </p>
            <div className="space-y-1.5">
              {["Code generation", "Diff quality", "Test suggestion", "Security detection"].map((item, i) => {
                const pcts = [94, 89, 82, 96];
                return (
                  <div key={item}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-muted-foreground/70">{item}</span>
                      <span className="text-[10px] text-foreground/70">{pcts[i]}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-border/30 overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pcts[i]}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
