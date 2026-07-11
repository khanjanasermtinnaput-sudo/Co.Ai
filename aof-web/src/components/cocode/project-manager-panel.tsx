"use client";

// Phase 73 — AI Project Manager
// Backlog analysis, milestone generation, sprint planning, daily reports.

import { useState } from "react";
import {
  ClipboardList, Target, BarChart3, AlertTriangle, Loader2,
  CheckCircle2, Circle, Clock, TrendingUp, TrendingDown, Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";

type Priority = "critical" | "high" | "medium" | "low";
type TaskStatus = "backlog" | "in-progress" | "review" | "done";

interface PMTask {
  id: string;
  title: string;
  priority: Priority;
  status: TaskStatus;
  complexity: number; // 1-5 story points
  estimatedDays: number;
  risk?: string;
}

const PRIORITY_COLOR: Record<Priority, string> = {
  critical: "text-red-400 bg-red-500/10",
  high:     "text-amber-400 bg-amber-500/10",
  medium:   "text-blue-400 bg-blue-500/10",
  low:      "text-muted-foreground bg-muted/30",
};

const MOCK_TASKS: PMTask[] = [
  { id: "1", title: "Implement OAuth2 refresh token rotation", priority: "critical", status: "in-progress", complexity: 3, estimatedDays: 2, risk: "Auth regression risk" },
  { id: "2", title: "Add rate limiting to /api/chat", priority: "high", status: "backlog", complexity: 2, estimatedDays: 1 },
  { id: "3", title: "Optimize bundle size — remove unused deps", priority: "medium", status: "backlog", complexity: 2, estimatedDays: 1 },
  { id: "4", title: "Write E2E tests for checkout flow", priority: "high", status: "review", complexity: 4, estimatedDays: 3 },
  { id: "5", title: "Fix mobile nav z-index on iOS Safari", priority: "medium", status: "done", complexity: 1, estimatedDays: 0.5 },
];

interface ProjectManagerPanelProps {
  className?: string;
}

export function ProjectManagerPanel({ className }: ProjectManagerPanelProps) {
  const [generating, setGenerating] = useState(false);
  const [activeView, setActiveView] = useState<"backlog" | "sprint" | "report">("backlog");
  const allFiles = useCocodeIDEStore((s) => s.allFiles);

  async function handleGenerate() {
    setGenerating(true);
    await new Promise((r) => setTimeout(r, 2000));
    setGenerating(false);
  }

  const blocked = MOCK_TASKS.filter((t) => t.risk && t.status !== "done");
  const inProgress = MOCK_TASKS.filter((t) => t.status === "in-progress");
  const totalPoints = MOCK_TASKS.filter((t) => t.status !== "done").reduce((s, t) => s + t.complexity, 0);

  const STATUS_ICON: Record<TaskStatus, React.ElementType> = {
    backlog: Circle,
    "in-progress": Loader2,
    review: Clock,
    done: CheckCircle2,
  };

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-4 text-primary" />
          <span className="font-semibold text-foreground">AI Project Manager</span>
        </div>
        <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating} className="h-6 px-2 text-[10px]">
          {generating ? <Loader2 className="size-3 animate-spin" /> : "Analyze"}
        </Button>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 border-b border-border/40">
        {[
          { label: "In Progress", value: inProgress.length, icon: TrendingUp, color: "text-blue-400" },
          { label: "Blockers", value: blocked.length, icon: AlertTriangle, color: "text-red-400" },
          { label: "Story Points", value: totalPoints, icon: Target, color: "text-primary" },
        ].map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="flex flex-col items-center gap-0.5 py-2.5 border-r last:border-r-0 border-border/40">
              <Icon className={cn("size-3.5", m.color)} />
              <span className={cn("text-base font-bold", m.color)}>{m.value}</span>
              <span className="text-[9px] text-muted-foreground/60">{m.label}</span>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/40 bg-card/20">
        {(["backlog", "sprint", "report"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveView(t)}
            className={cn(
              "flex-1 py-2 text-[11px] font-medium capitalize transition-colors",
              activeView === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "backlog" ? "Backlog" : t === "sprint" ? "Sprint" : "Report"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {activeView === "backlog" && (
          <>
            {blocked.length > 0 && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 mb-3">
                <p className="flex items-center gap-1.5 font-medium text-red-400 mb-1">
                  <AlertTriangle className="size-3" /> {blocked.length} blocker{blocked.length !== 1 ? "s" : ""} detected
                </p>
                {blocked.map((t) => (
                  <p key={t.id} className="text-[11px] text-red-800/70 dark:text-red-300/70 pl-4">· {t.risk}</p>
                ))}
              </div>
            )}
            {MOCK_TASKS.filter((t) => t.status !== "done").map((task) => {
              const StatusIcon = STATUS_ICON[task.status];
              return (
                <div key={task.id} className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 hover:bg-card/50 transition-colors">
                  <div className="flex items-start gap-2">
                    <StatusIcon className={cn("mt-0.5 size-3.5 shrink-0", task.status === "in-progress" ? "animate-spin text-blue-400" : "text-muted-foreground/50")} />
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground font-medium leading-tight">{task.title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase", PRIORITY_COLOR[task.priority])}>
                          {task.priority}
                        </span>
                        <span className="text-[10px] text-muted-foreground/50">{task.complexity} pts · ~{task.estimatedDays}d</span>
                        {task.risk && <span className="text-[10px] text-red-400/70 flex items-center gap-0.5"><AlertTriangle className="size-2.5" />{task.risk}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {activeView === "sprint" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
              <p className="font-semibold text-foreground flex items-center gap-2">
                <Calendar className="size-4 text-primary" />
                Sprint Recommendation
              </p>
              <p className="mt-2 text-muted-foreground leading-relaxed">
                AI recommends focusing on the auth token rotation and API rate limiting this sprint. Together they close 2 critical security gaps and unblock the mobile team.
              </p>
              <div className="mt-3 space-y-1">
                {MOCK_TASKS.filter((t) => ["critical", "high"].includes(t.priority) && t.status !== "done").map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-[11px]">
                    <CheckCircle2 className="size-3 text-primary/60" />
                    <span className="text-muted-foreground">{t.title}</span>
                    <span className="ml-auto text-primary/60">{t.complexity}pt</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-border/40 bg-card/30 px-4 py-3">
              <p className="font-medium text-muted-foreground text-[11px] flex items-center gap-1.5">
                <BarChart3 className="size-3.5" /> Velocity Forecast
              </p>
              <div className="mt-2 space-y-1.5">
                {["Week 1", "Week 2", "Week 3"].map((w, i) => (
                  <div key={w} className="flex items-center gap-2">
                    <span className="w-12 text-[10px] text-muted-foreground/60">{w}</span>
                    <div className="flex-1 rounded-full bg-border/30 h-1.5 overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${[65, 80, 90][i]}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground/60">{[65, 80, 90][i]}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeView === "report" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-border/40 bg-card/30 px-4 py-3">
              <p className="font-semibold text-foreground mb-2 flex items-center gap-2">
                <TrendingUp className="size-4 text-emerald-400" /> Daily Engineering Report
              </p>
              <ul className="space-y-1.5 text-muted-foreground">
                {[
                  "Auth token rotation: 60% complete, on track for EOD",
                  "E2E tests merged to review — 2 reviewers assigned",
                  "Bundle size reduced 12% from yesterday",
                  "0 new critical bugs introduced in last 24h",
                ].map((item) => (
                  <li key={item} className="flex gap-2 text-[11px]">
                    <CheckCircle2 className="size-3 mt-0.5 shrink-0 text-emerald-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <p className="font-medium text-amber-400 mb-2 flex items-center gap-2">
                <TrendingDown className="size-4" /> Risk Alerts
              </p>
              <ul className="space-y-1 text-[11px] text-amber-800/80 dark:text-amber-300/80">
                <li>· Auth PR has 0 reviewers — at risk of blocking mobile release</li>
                <li>· Test coverage dropped 3% this week</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
