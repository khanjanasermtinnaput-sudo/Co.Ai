"use client";

// ── Adaptive Workflow Indicator (Phase 11) ────────────────────────────────────
// Shows which workflow is running (small/medium/large), active agents, progress.

import { CheckCircle2, Circle, Loader2, XCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";
import type { WorkflowStep } from "@/lib/cocode/adaptive-workflow";

const SIZE_COLOR = {
  small: "text-emerald-400",
  medium: "text-amber-400",
  large: "text-purple-400",
} as const;

const SIZE_BG = {
  small: "bg-emerald-500/10 border-emerald-500/20",
  medium: "bg-amber-500/10 border-amber-500/20",
  large: "bg-purple-500/10 border-purple-500/20",
} as const;

const SIZE_LABEL = {
  small: "Quick Fix",
  medium: "Feature",
  large: "Full Pipeline",
} as const;

function StepIcon({ status }: { status: WorkflowStep["status"] }) {
  switch (status) {
    case "running": return <Loader2 className="size-3.5 animate-spin text-primary" />;
    case "done": return <CheckCircle2 className="size-3.5 text-emerald-400" />;
    case "failed": return <XCircle className="size-3.5 text-red-400" />;
    case "skipped": return <Circle className="size-3.5 text-muted-foreground/30" />;
    default: return <Circle className="size-3.5 text-muted-foreground/40" />;
  }
}

export function WorkflowIndicator() {
  const workflow = useCocodeIDEStore((s) => s.workflow);
  const steps = useCocodeIDEStore((s) => s.workflowSteps);

  if (!workflow) return null;

  const running = steps.some((s) => s.status === "running");
  const done = steps.every((s) => s.status === "done" || s.status === "skipped");
  const failed = steps.some((s) => s.status === "failed");

  const pct = steps.length
    ? Math.round(
        (steps.filter((s) => s.status === "done" || s.status === "skipped").length / steps.length) * 100,
      )
    : 0;

  return (
    <div
      className={cn(
        "rounded-xl border p-3 text-[12px]",
        SIZE_BG[workflow.size],
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <Zap className={cn("size-3.5 shrink-0", SIZE_COLOR[workflow.size])} />
        <span className={cn("font-medium", SIZE_COLOR[workflow.size])}>
          {SIZE_LABEL[workflow.size]}
        </span>
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground/70">{workflow.reason}</span>
        {running && (
          <span className="ml-auto font-mono text-muted-foreground/60">{pct}%</span>
        )}
        {done && !failed && (
          <span className="ml-auto text-emerald-400">Complete</span>
        )}
        {failed && (
          <span className="ml-auto text-red-400">Failed</span>
        )}
      </div>

      {/* Progress bar */}
      {steps.length > 0 && (
        <div className="mt-2 h-0.5 w-full rounded-full bg-white/10">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              failed ? "bg-red-400" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Steps */}
      {steps.length > 0 && (
        <div className="mt-2 space-y-1">
          {steps.map((step) => (
            <div key={step.id} className="flex items-center gap-2">
              <StepIcon status={step.status} />
              <span
                className={cn(
                  "truncate",
                  step.status === "running" && "text-foreground",
                  step.status === "done" && "text-muted-foreground/70",
                  step.status === "pending" && "text-muted-foreground/40",
                  step.status === "failed" && "text-red-400",
                )}
              >
                {step.label}
              </span>
              {step.startedAt && step.completedAt && (
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/40">
                  {((step.completedAt - step.startedAt) / 1000).toFixed(1)}s
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Latency estimate */}
      {!running && !done && (
        <p className="mt-1.5 text-[11px] text-muted-foreground/50">
          Est. ~{(workflow.estimatedLatencyMs / 1000).toFixed(0)}s · {workflow.agents.length} agent{workflow.agents.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
