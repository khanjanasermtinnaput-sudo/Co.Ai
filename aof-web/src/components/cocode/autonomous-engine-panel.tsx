"use client";

// Phase 80 — Autonomous Software Engineering Platform
// Full AI loop: Requirements → Architecture → Plan → Code → Review → Test → Deploy → Monitor → Learn
// Humans define vision, approve decisions, review critical changes.

import { useState } from "react";
import {
  Bot, CheckCircle, Loader2, Clock, AlertTriangle, GitPullRequest,
  Eye, ThumbsUp, ThumbsDown, Zap, Play, Pause, RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type AgentPhase =
  | "idle" | "requirements" | "architecture" | "planning" | "coding"
  | "reviewing" | "testing" | "deploying" | "monitoring" | "learning";

type StepStatus = "pending" | "running" | "waiting-approval" | "approved" | "done" | "failed";

interface AutonomousStep {
  phase: AgentPhase;
  label: string;
  description: string;
  status: StepStatus;
  output?: string;
  requiresApproval?: boolean;
}

const PHASES: AutonomousStep[] = [
  { phase: "requirements", label: "Understand Requirements",   description: "Parse and clarify the engineering request",           status: "done",             output: "Implement rate limiting on /api/chat endpoint. 100 req/min per IP." },
  { phase: "architecture", label: "Create Architecture",       description: "Design system components and data flow",              status: "done",             output: "Redis-backed sliding window counter. Middleware-first approach." },
  { phase: "planning",     label: "Plan Implementation",       description: "Break into tasks, estimate complexity",               status: "done",             output: "3 tasks: middleware, Redis config, tests. ~4h estimate." },
  { phase: "coding",       label: "Generate Code",             description: "Write implementation files with tests",               status: "running",          output: "Generating src/lib/rate-limit.ts…" },
  { phase: "reviewing",    label: "Review Code",               description: "AI self-review for bugs, security, style",           status: "pending" },
  { phase: "testing",      label: "Run Tests",                 description: "Execute test suite, verify no regressions",          status: "pending" },
  { phase: "deploying",    label: "Deploy",                    description: "Build and deploy to staging for validation",         status: "pending",          requiresApproval: true },
  { phase: "monitoring",   label: "Monitor",                   description: "Observe error rates, latency, abuse patterns",       status: "pending" },
  { phase: "learning",     label: "Learn & Improve",           description: "Update internal knowledge from this deployment",     status: "pending" },
];

const STATUS_ICON: Record<StepStatus, React.ElementType> = {
  pending:          Clock,
  running:          Loader2,
  "waiting-approval": Eye,
  approved:         CheckCircle,
  done:             CheckCircle,
  failed:           AlertTriangle,
};

const STATUS_COLOR: Record<StepStatus, string> = {
  pending:            "text-muted-foreground/30",
  running:            "text-primary animate-spin",
  "waiting-approval": "text-amber-400",
  approved:           "text-emerald-400",
  done:               "text-emerald-400",
  failed:             "text-red-400",
};

interface AutonomousEnginePanelProps {
  className?: string;
}

export function AutonomousEnginePanel({ className }: AutonomousEnginePanelProps) {
  const [running, setRunning] = useState(true);
  const [steps, setSteps] = useState<AutonomousStep[]>(PHASES);
  const [request, setRequest] = useState("Add rate limiting to /api/chat — 100 requests per minute per IP");

  const currentStep = steps.find((s) => s.status === "running" || s.status === "waiting-approval");
  const completedCount = steps.filter((s) => s.status === "done" || s.status === "approved").length;
  const progress = Math.round((completedCount / steps.length) * 100);

  function handleApprove(phase: AgentPhase) {
    setSteps((prev) => prev.map((s) => s.phase === phase ? { ...s, status: "approved" } : s));
  }

  function handleReject(phase: AgentPhase) {
    setSteps((prev) => prev.map((s) => s.phase === phase ? { ...s, status: "failed" } : s));
  }

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Autonomous Engine</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={cn("flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
            running ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/30 text-muted-foreground")}>
            <div className={cn("size-1.5 rounded-full", running ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/40")} />
            {running ? "Running" : "Paused"}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setRunning((r) => !r)} className="h-6 w-6 p-0">
            {running ? <Pause className="size-3" /> : <Play className="size-3" />}
          </Button>
        </div>
      </div>

      {/* Mission */}
      <div className="border-b border-border/40 bg-primary/5 px-4 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-primary/60 mb-0.5">Current Mission</p>
        <p className="text-[11px] text-foreground/80">{request}</p>
      </div>

      {/* Progress bar */}
      <div className="border-b border-border/40 px-4 py-2 bg-card/20">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground/60">Overall Progress</span>
          <span className="text-[10px] font-semibold text-foreground">{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-border/30 overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all duration-700" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Approval alert */}
      {currentStep?.status === "waiting-approval" && (
        <div className="flex items-start gap-2 border-b border-amber-500/20 bg-amber-500/5 px-4 py-3">
          <Eye className="size-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-amber-400 text-[11px]">Human approval required: {currentStep.label}</p>
            <p className="text-[10px] text-muted-foreground/60 mt-0.5">{currentStep.description}</p>
            <div className="flex gap-1.5 mt-2">
              <Button size="sm" className="h-6 px-2.5 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-500" onClick={() => handleApprove(currentStep.phase)}>
                <ThumbsUp className="size-2.5" /> Approve
              </Button>
              <Button size="sm" variant="outline" className="h-6 px-2.5 text-[10px] gap-1 text-red-400 border-red-500/30 hover:bg-red-500/10" onClick={() => handleReject(currentStep.phase)}>
                <ThumbsDown className="size-2.5" /> Reject
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Pipeline steps */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {steps.map((step, i) => {
          const Icon = STATUS_ICON[step.status];
          const isActive = step.status === "running" || step.status === "waiting-approval";
          return (
            <div
              key={step.phase}
              className={cn(
                "rounded-xl border px-3 py-2.5 transition-colors",
                isActive ? "border-primary/30 bg-primary/5" :
                step.status === "done" || step.status === "approved" ? "border-emerald-500/20 bg-emerald-500/5 opacity-80" :
                step.status === "failed" ? "border-red-500/20 bg-red-500/5" :
                "border-border/30 bg-card/20 opacity-50",
              )}
            >
              <div className="flex items-start gap-2.5">
                <Icon className={cn("mt-0.5 size-3.5 shrink-0", STATUS_COLOR[step.status])} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={cn("font-medium", isActive ? "text-foreground" : "text-foreground/70")}>{step.label}</p>
                    {step.requiresApproval && step.status === "pending" && (
                      <span className="text-[9px] rounded-full bg-amber-500/15 text-amber-400 px-1.5 py-0.5">needs approval</span>
                    )}
                  </div>
                  {isActive && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{step.description}</p>}
                  {step.output && (isActive || step.status === "done") && (
                    <p className="mt-1.5 rounded-lg bg-black/20 px-2 py-1.5 font-mono text-[10px] text-muted-foreground/70">{step.output}</p>
                  )}
                </div>
                <span className="shrink-0 text-[10px] font-mono text-muted-foreground/30">{(i + 1).toString().padStart(2, "0")}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="border-t border-border/40 bg-card/20 px-4 py-2.5 flex items-center gap-2">
        <Zap className="size-3 text-primary/60" />
        <span className="flex-1 text-[10px] text-muted-foreground/60">AI handles routine engineering. You control strategic decisions.</span>
        <Button size="sm" variant="ghost" className="h-6 px-2 gap-1 text-[10px] text-muted-foreground/60">
          <RotateCcw className="size-2.5" /> Reset
        </Button>
      </div>
    </div>
  );
}
