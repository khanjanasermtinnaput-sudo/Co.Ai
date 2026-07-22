"use client";

// ── Workflow Progress — user-facing AI activity ───────────────────────────────
// Replaces the old single-line AgentStatusBar. Shows only the phases a turn
// ACTUALLY ran (a Kanon-low turn is Building → Reviewing, never a padded
// five-phase bar) and, once the reply is done, collapses into a "Why did
// Co.AI do this?" expander built entirely from real StageNotice data — no
// chain-of-thought, just which real stages ran, in what order, and how long
// each took.

import { useMemo, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui-store";
import { PHASE_ORDER, phaseForStage, type WorkflowPhase } from "@/lib/workflow-phases";
import type { StageNotice } from "@/lib/errors";

interface PhaseGroup {
  phase: WorkflowPhase | string;
  stages: StageNotice[];
  done: boolean;
}

function groupByPhase(trail: StageNotice[]): PhaseGroup[] {
  const byPhase = new Map<WorkflowPhase | string, StageNotice[]>();
  for (const st of trail) {
    const phase = phaseForStage(st.stage, st.label);
    byPhase.set(phase, [...(byPhase.get(phase) ?? []), st]);
  }
  // Canonical order first, then anything unrecognized in first-seen order.
  const seen = new Set(byPhase.keys());
  const ordered = [
    ...PHASE_ORDER.filter((p) => seen.has(p)),
    ...[...seen].filter((p) => !PHASE_ORDER.includes(p as WorkflowPhase)),
  ];
  return ordered.map((phase) => {
    const stages = byPhase.get(phase)!;
    return { phase, stages, done: stages.every((s) => s.status === "done") };
  });
}

export function WorkflowProgress({ stageTrail, streaming }: { stageTrail?: StageNotice[]; streaming?: boolean }) {
  const developerMode = useUIStore((s) => s.developerMode);
  const [expanded, setExpanded] = useState(false);

  const groups = useMemo(() => groupByPhase(stageTrail ?? []), [stageTrail]);
  if (groups.length === 0) return null;

  const currentIdx = groups.findIndex((g) => !g.done);

  // While streaming: a live phase-chip row. Once done: a collapsed expander.
  if (streaming) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {groups.map((g, i) => {
          const isCurrent = i === currentIdx || (currentIdx === -1 && i === groups.length - 1);
          const isPast = currentIdx === -1 ? i < groups.length - 1 : i < currentIdx;
          return (
            <span
              key={g.phase}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-caption font-medium",
                isCurrent
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : isPast
                    ? "border-border bg-secondary/40 text-muted-foreground"
                    : "border-border/50 text-muted-foreground/50",
              )}
            >
              {isCurrent ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <span className={cn("size-1.5 rounded-full", isPast ? "bg-muted-foreground" : "bg-muted-foreground/40")} />
              )}
              {g.phase}
            </span>
          );
        })}
      </div>
    );
  }

  const firstTs = stageTrail?.[0] ? new Date(stageTrail[0].timestamp).getTime() : 0;

  return (
    <div className="w-fit">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-caption text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
        Why did Co.AI do this?
        <span className="text-muted-foreground/60">
          ({groups.map((g) => g.phase).join(" → ")})
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-col gap-1 rounded-lg border border-border bg-secondary/20 p-2.5">
          {groups.flatMap((g) => g.stages).map((st) => {
            const deltaMs = new Date(st.timestamp).getTime() - firstTs;
            return (
              <div key={`${st.stage}-${st.timestamp}`} className="flex items-center gap-2 text-caption">
                <span className="w-16 shrink-0 text-muted-foreground/70">
                  +{(deltaMs / 1000).toFixed(1)}s
                </span>
                <span className="flex-1 text-foreground">{st.label}</span>
                <span className="text-muted-foreground/60">{st.status}</span>
                {developerMode && (
                  <span className="font-mono text-micro text-muted-foreground/50">
                    {st.stage} · {st.index}/{st.total}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
