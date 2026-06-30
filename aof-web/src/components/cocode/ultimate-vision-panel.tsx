"use client";

// Phase 100 — CoCode Ultimate Vision
// The complete software lifecycle in one view: Idea → Deployment → Continuous Learning.
// Displays the full 20-stage engineering journey, core principles, non-negotiable standards,
// long-term architecture, and the final mission statement.

import { useState } from "react";
import { Rocket, CheckCircle, Circle, ArrowDown, Shield, Zap, Eye, GitMerge, Layers, Star, BookOpen, Target } from "lucide-react";
import { cn } from "@/lib/utils";

type VisionView = "lifecycle" | "principles" | "standards" | "architecture";

interface LifecycleStage {
  stage: number;
  name: string;
  description: string;
  status: "complete" | "active" | "pending";
  phase: string;
}

const LIFECYCLE: LifecycleStage[] = [
  { stage: 1,  name: "Idea",                  description: "Innovation Engine generates evidence-based opportunities",                status: "complete", phase: "Phase 97" },
  { stage: 2,  name: "Requirement Analysis",  description: "Business Requirements AI aligns with revenue, retention, market goals",  status: "complete", phase: "Phase 92" },
  { stage: 3,  name: "Product Planning",       description: "AI Project Manager creates backlog, sprint, and roadmap",               status: "complete", phase: "Phase 73" },
  { stage: 4,  name: "Architecture Design",   description: "Architecture Evolution AI proposes with evidence and risk assessment",   status: "complete", phase: "Phase 83" },
  { stage: 5,  name: "UI/UX Design",          description: "AI Product Designer generates flows, wireframes, and accessibility plan",status: "complete", phase: "Phase 93" },
  { stage: 6,  name: "Database Design",       description: "Database Studio with AI migration generation and safety validation",     status: "complete", phase: "Phase 31" },
  { stage: 7,  name: "API Design",            description: "API Studio generates contracts, OpenAPI specs, and validation",          status: "complete", phase: "Phase 32" },
  { stage: 8,  name: "Implementation",        description: "Chief AI orchestrates Engineering department agents",                    status: "active",   phase: "Phase 91" },
  { stage: 9,  name: "Code Review",           description: "AI Review with security, performance, and style analysis",              status: "active",   phase: "Phase 43" },
  { stage: 10, name: "Testing",               description: "QA Platform: unit, integration, E2E, cross-browser, cross-device",     status: "pending",  phase: "Phase 95" },
  { stage: 11, name: "Security Validation",   description: "Security Engine: OWASP scan, key audit, RLS check, CSP validation",    status: "pending",  phase: "Phase 77" },
  { stage: 12, name: "Performance Optimization", description: "Predictive Intel flags regressions. Simulation validates capacity", status: "pending",  phase: "Phase 96" },
  { stage: 13, name: "Documentation",         description: "Living Docs auto-sync with every approved change",                      status: "pending",  phase: "Phase 85" },
  { stage: 14, name: "Deployment",            description: "AI DevOps: canary release, health check, rollback if P99 spikes",      status: "pending",  phase: "Phase 75" },
  { stage: 15, name: "Monitoring",            description: "Monitoring Engine: metrics, logs, traces, anomaly detection",           status: "pending",  phase: "Phase 90" },
  { stage: 16, name: "Incident Response",     description: "8-step AI pipeline: logs → root cause → hotfix PR → rollback",         status: "pending",  phase: "Phase 77" },
  { stage: 17, name: "Maintenance",           description: "Autonomous Refactor Engine proposes cleanup with human approval",       status: "pending",  phase: "Phase 84" },
  { stage: 18, name: "Continuous Learning",   description: "Self-Improving AI stores validated patterns from every task",           status: "pending",  phase: "Phase 81" },
  { stage: 19, name: "Continuous Improvement",description: "Global Intelligence aggregates trends and surfaces next opportunities", status: "pending",  phase: "Phase 89" },
  { stage: 20, name: "→ Next Cycle",          description: "Back to Idea — perpetual loop with accumulated intelligence",           status: "pending",  phase: "Phase 100" },
];

const CORE_PRINCIPLES = [
  { icon: Eye,      text: "Human remains in control of strategic decisions" },
  { icon: Zap,      text: "AI automates repetitive and analytical engineering work" },
  { icon: Eye,      text: "Every action is explainable" },
  { icon: GitMerge, text: "Every change is reviewable" },
  { icon: Rocket,   text: "Every deployment is reversible" },
  { icon: Target,   text: "Every recommendation is evidence-based" },
  { icon: Layers,   text: "Every subsystem is modular" },
  { icon: Shield,   text: "Every workflow is observable" },
  { icon: CheckCircle, text: "Every feature is production-ready" },
  { icon: Star,     text: "Simplicity is preferred over unnecessary complexity" },
];

const NON_NEGOTIABLE = [
  "Secure", "Performant", "Accessible", "Testable", "Documented",
  "Observable", "Maintainable", "Scalable", "Modular", "Recoverable",
  "Versioned", "Explainable",
];

const ARCH_LAYERS = [
  { name: "User",                  color: "text-foreground"        },
  { name: "Chief AI",              color: "text-primary"           },
  { name: "Adaptive Workflow Engine", color: "text-blue-400"       },
  { name: "TMAP (Large Tasks Only)",  color: "text-purple-400"     },
  { name: "Specialized AI Agents",    color: "text-emerald-400"    },
  { name: "Repository Intelligence",  color: "text-cyan-400"       },
  { name: "Knowledge Graph",          color: "text-amber-400"      },
  { name: "Memory Engine",            color: "text-primary"        },
  { name: "Diff + Testing + Security",color: "text-red-400"        },
  { name: "Deployment + Monitoring",  color: "text-indigo-400"     },
  { name: "Analytics + Learning",     color: "text-pink-400"       },
  { name: "Continuous Evolution",     color: "text-muted-foreground/60" },
];

interface UltimateVisionPanelProps { className?: string }

export function UltimateVisionPanel({ className }: UltimateVisionPanelProps) {
  const [view, setView] = useState<VisionView>("lifecycle");

  const completedStages = LIFECYCLE.filter((s) => s.status === "complete").length;
  const activeStages    = LIFECYCLE.filter((s) => s.status === "active").length;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <Rocket className="size-4 text-primary" />
          <span className="font-semibold text-foreground">CoCode Ultimate Vision</span>
          <span className="ml-auto text-[10px] text-muted-foreground/40">Phase 100 · Complete</span>
        </div>
        <p className="text-[10px] text-muted-foreground/50 italic">
          "Build an AI Software Engineering OS that augments engineers, not replaces them."
        </p>
      </div>

      <div className="border-b border-border/40 bg-card/10 px-4 py-2">
        <div className="flex items-center gap-4 text-[10px]">
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground/60">{completedStages} stages complete</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-primary animate-pulse" />
            <span className="text-muted-foreground/60">{activeStages} active</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="size-2 rounded-full bg-border/50" />
            <span className="text-muted-foreground/60">{LIFECYCLE.length - completedStages - activeStages} pending</span>
          </div>
        </div>
      </div>

      <div className="flex border-b border-border/40 bg-card/20 overflow-x-auto no-scrollbar">
        {([
          { key: "lifecycle",   label: "Lifecycle"   },
          { key: "principles",  label: "Principles"  },
          { key: "standards",   label: "Standards"   },
          { key: "architecture",label: "Architecture"},
        ] as { key: VisionView; label: string }[]).map((t) => (
          <button key={t.key} type="button" onClick={() => setView(t.key)}
            className={cn("shrink-0 px-3 py-2 text-[11px] font-medium transition-colors",
              view === t.key ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {view === "lifecycle" && (
          <div className="space-y-1">
            {LIFECYCLE.map((stage, i) => {
              const isLast = i === LIFECYCLE.length - 1;
              return (
                <div key={stage.stage} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={cn("size-5 rounded-full border-2 flex items-center justify-center shrink-0",
                      stage.status === "complete" ? "bg-emerald-500/20 border-emerald-500 text-emerald-400" :
                      stage.status === "active"   ? "bg-primary/20 border-primary text-primary animate-pulse" :
                                                    "border-border/40 bg-card/30 text-muted-foreground/30")}>
                      {stage.status === "complete" ? <CheckCircle className="size-3" /> :
                       stage.status === "active"   ? <div className="size-1.5 rounded-full bg-primary" /> :
                                                     <Circle className="size-2.5" />}
                    </div>
                    {!isLast && <div className={cn("w-px flex-1 my-0.5 min-h-[16px]", stage.status === "complete" ? "bg-emerald-500/30" : "bg-border/30")} />}
                  </div>
                  <div className="pb-3 flex-1 min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className={cn("font-medium leading-tight",
                        stage.status === "complete" ? "text-foreground" :
                        stage.status === "active"   ? "text-primary" : "text-muted-foreground/60")}>
                        {stage.name}
                      </span>
                      <span className="text-[9px] text-muted-foreground/30 font-mono">{stage.phase}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/50 leading-snug mt-0.5">{stage.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {view === "principles" && (
          <div className="space-y-2">
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 mb-3">
              <p className="text-[11px] font-medium text-primary/80 leading-relaxed">
                "Build an AI Software Engineering Operating System that augments engineers, not replaces them. Every feature should reduce cognitive load, increase software quality, and preserve human oversight."
              </p>
            </div>
            {CORE_PRINCIPLES.map((p, i) => {
              const Icon = p.icon;
              return (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/30 px-3 py-2.5">
                  <Icon className="size-3.5 text-primary/60 shrink-0" />
                  <p className="text-[11px] text-muted-foreground/80">{p.text}</p>
                </div>
              );
            })}
          </div>
        )}

        {view === "standards" && (
          <div className="space-y-3">
            <p className="text-[10px] text-muted-foreground/50 px-1">Every feature must meet all 12 non-negotiable standards before shipping.</p>
            <div className="grid grid-cols-2 gap-2">
              {NON_NEGOTIABLE.map((standard) => (
                <div key={standard} className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                  <CheckCircle className="size-3.5 text-emerald-400 shrink-0" />
                  <span className="font-medium text-foreground/80">{standard}</span>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 mt-2">
              <p className="text-[10px] text-primary/70">These standards apply to every phase from 1 to 100. Non-negotiable means no exceptions — even under deadline pressure.</p>
            </div>
          </div>
        )}

        {view === "architecture" && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground/50 px-1 pb-2">Long-term architecture — every request flows through this stack.</p>
            {ARCH_LAYERS.map((layer, i) => {
              const isLast = i === ARCH_LAYERS.length - 1;
              return (
                <div key={layer.name} className="flex flex-col items-center gap-0.5">
                  <div className={cn("w-full rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 text-center font-medium", layer.color)}>
                    {layer.name}
                  </div>
                  {!isLast && <ArrowDown className="size-3 text-border/40" />}
                </div>
              );
            })}
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 mt-3 text-center">
              <p className="text-[10px] text-primary/70 font-medium">CoCode — AI Software Engineering Operating System</p>
              <p className="text-[9px] text-muted-foreground/40 mt-0.5">Phase 1–100 · Complete</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
