"use client";

// Phase 91 — Autonomous Software Company
// AI organization with 11 specialized departments, all coordinated by Chief AI.
// Each department has dedicated agents, active tasks, and health status.

import { useState } from "react";
import { Building2, Cpu, Code2, Palette, Shield, TestTube, Globe, FileText, HeadphonesIcon, BarChart3, GitMerge, ChevronRight, Loader2, CheckCircle, AlertTriangle, Play } from "lucide-react";
import { cn } from "@/lib/utils";

type DeptStatus = "active" | "idle" | "busy" | "blocked";

interface Agent {
  name: string;
  role: string;
  currentTask: string | null;
}

interface Department {
  id: string;
  name: string;
  icon: React.ElementType;
  color: string;
  status: DeptStatus;
  agents: Agent[];
  completedToday: number;
  queueDepth: number;
}

const STATUS_CONFIG: Record<DeptStatus, { color: string; label: string; icon: React.ElementType }> = {
  active:  { color: "text-emerald-400", label: "Active",  icon: CheckCircle  },
  idle:    { color: "text-muted-foreground/40", label: "Idle", icon: CheckCircle },
  busy:    { color: "text-primary",     label: "Busy",   icon: Loader2       },
  blocked: { color: "text-red-400",     label: "Blocked",icon: AlertTriangle },
};

const DEPARTMENTS: Department[] = [
  {
    id: "chief",  name: "Chief AI",       icon: Cpu,              color: "text-primary bg-primary/10 border-primary/20",
    status: "active", completedToday: 47, queueDepth: 3,
    agents: [
      { name: "Chief",      role: "Orchestrator",    currentTask: "Routing 3 active requests to Engineering + QA" },
    ],
  },
  {
    id: "eng",    name: "Engineering",    icon: Code2,            color: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    status: "busy", completedToday: 28, queueDepth: 5,
    agents: [
      { name: "Coder",      role: "Implementation",  currentTask: "Implementing Phase 91 panel components" },
      { name: "Reviewer",   role: "Code Review",     currentTask: "Reviewing 2 open PRs" },
      { name: "Architect",  role: "Design",          currentTask: null },
    ],
  },
  {
    id: "product",name: "Product",        icon: BarChart3,        color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    status: "active", completedToday: 12, queueDepth: 2,
    agents: [
      { name: "PM Agent",   role: "Product Manager", currentTask: "Updating sprint backlog with Phase 100 items" },
      { name: "Roadmapper", role: "Roadmap",         currentTask: null },
    ],
  },
  {
    id: "design", name: "Design",         icon: Palette,          color: "text-pink-400 bg-pink-500/10 border-pink-500/20",
    status: "active", completedToday: 8, queueDepth: 1,
    agents: [
      { name: "UX Agent",   role: "UX Designer",     currentTask: "Generating wireframes for Phase 93 panel" },
      { name: "DS Agent",   role: "Design System",   currentTask: null },
    ],
  },
  {
    id: "security",name: "Security",     icon: Shield,           color: "text-red-400 bg-red-500/10 border-red-500/20",
    status: "active", completedToday: 21, queueDepth: 0,
    agents: [
      { name: "SecBot",     role: "Vulnerability Scan", currentTask: "Running OWASP audit on new API endpoints" },
      { name: "KeyRotator", role: "Secrets Manager",    currentTask: null },
    ],
  },
  {
    id: "qa",     name: "QA",            icon: TestTube,         color: "text-yellow-400 bg-yellow-500/10 border-yellow-500/20",
    status: "busy", completedToday: 34, queueDepth: 7,
    agents: [
      { name: "E2E Agent",  role: "E2E Testing",      currentTask: "Running Playwright suite — 87/120 tests passed" },
      { name: "Perf Agent", role: "Performance QA",   currentTask: "Benchmarking Phase 88 simulation engine" },
      { name: "A11y Agent", role: "Accessibility",    currentTask: null },
    ],
  },
  {
    id: "devops", name: "DevOps",        icon: Globe,            color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
    status: "active", completedToday: 15, queueDepth: 2,
    agents: [
      { name: "Deploy Bot", role: "Deployments",      currentTask: "Monitoring Railway deployment — 98% healthy" },
      { name: "Infra Bot",  role: "Infrastructure",   currentTask: null },
    ],
  },
  {
    id: "docs",   name: "Documentation", icon: FileText,         color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    status: "active", completedToday: 9, queueDepth: 3,
    agents: [
      { name: "DocBot",     role: "Doc Generator",    currentTask: "Syncing API docs after Phase 90 merge" },
    ],
  },
  {
    id: "support",name: "Customer Support",icon: HeadphonesIcon, color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    status: "idle", completedToday: 6, queueDepth: 0,
    agents: [
      { name: "SupportBot", role: "Tier-1 Support",   currentTask: null },
    ],
  },
  {
    id: "data",   name: "Data Analysis", icon: BarChart3,        color: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
    status: "active", completedToday: 18, queueDepth: 1,
    agents: [
      { name: "Analyst",    role: "Data Analyst",     currentTask: "Generating weekly engineering velocity report" },
      { name: "BI Agent",   role: "Business Intel",   currentTask: null },
    ],
  },
  {
    id: "release",name: "Release Management",icon: GitMerge,     color: "text-orange-400 bg-orange-500/10 border-orange-500/20",
    status: "active", completedToday: 4, queueDepth: 0,
    agents: [
      { name: "ReleaseBot", role: "Release Manager",  currentTask: "Preparing v1.10.0 changelog and tag" },
    ],
  },
];

interface AutonomousCompanyPanelProps { className?: string }

export function AutonomousCompanyPanel({ className }: AutonomousCompanyPanelProps) {
  const [selected, setSelected] = useState<string | null>(null);

  const selectedDept = DEPARTMENTS.find((d) => d.id === selected);
  const totalActive = DEPARTMENTS.filter((d) => d.status === "active" || d.status === "busy").length;
  const totalCompleted = DEPARTMENTS.reduce((a, d) => a + d.completedToday, 0);

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Autonomous Software Company</span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-emerald-400">{totalActive} depts active</span>
          <span className="text-muted-foreground/50">{totalCompleted} tasks today</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Department list */}
        <div className={cn("overflow-y-auto p-3 space-y-1.5", selected ? "w-52 shrink-0 border-r border-border/40" : "flex-1")}>
          {/* Chief AI always first */}
          {DEPARTMENTS.map((dept) => {
            const Icon = dept.icon;
            const stCfg = STATUS_CONFIG[dept.status];
            const StIcon = stCfg.icon;
            const isChief = dept.id === "chief";
            return (
              <button
                key={dept.id}
                type="button"
                onClick={() => setSelected(selected === dept.id ? null : dept.id)}
                className={cn(
                  "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                  isChief ? "border-primary/40 bg-primary/8" : selected === dept.id ? "border-primary/30 bg-primary/5" : "border-border/40 bg-card/30 hover:bg-card/50",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <div className={cn("rounded-lg p-1.5 shrink-0", dept.color)}>
                    <Icon className="size-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-foreground block truncate">{dept.name}</span>
                    {!selected && (
                      <span className="text-[10px] text-muted-foreground/50">
                        {dept.agents.length} agent{dept.agents.length !== 1 ? "s" : ""} · {dept.completedToday} done today
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {dept.queueDepth > 0 && (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] text-primary">{dept.queueDepth}</span>
                    )}
                    <StIcon className={cn("size-3", stCfg.color, dept.status === "busy" && "animate-spin")} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Department detail */}
        {selected && selectedDept && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="flex items-center gap-3">
              <div className={cn("rounded-xl p-2.5", selectedDept.color)}>
                <selectedDept.icon className="size-5" />
              </div>
              <div>
                <p className="font-semibold text-foreground">{selectedDept.name}</p>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className={STATUS_CONFIG[selectedDept.status].color}>{STATUS_CONFIG[selectedDept.status].label}</span>
                  <span className="text-muted-foreground/40">·</span>
                  <span className="text-muted-foreground/50">{selectedDept.completedToday} completed today</span>
                  {selectedDept.queueDepth > 0 && (
                    <span className="text-primary">{selectedDept.queueDepth} in queue</span>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">Agents</p>
              {selectedDept.agents.map((agent, i) => (
                <div key={i} className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-foreground">{agent.name}</span>
                    <span className="text-[9px] text-muted-foreground/50 bg-muted/20 rounded px-1.5 py-0.5">{agent.role}</span>
                  </div>
                  {agent.currentTask ? (
                    <div className="flex items-start gap-1.5">
                      <Loader2 className="size-3 text-primary animate-spin shrink-0 mt-0.5" />
                      <p className="text-[10px] text-muted-foreground/70 leading-snug">{agent.currentTask}</p>
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground/30 italic">Waiting for next task</p>
                  )}
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-primary/15 bg-primary/5 px-3 py-2.5">
              <p className="text-[10px] text-primary/70">All departments report to Chief AI. Humans approve all strategic decisions and deployment actions.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
