"use client";

// Phase 75 — AI DevOps Engineer
// CI/CD, Docker, Kubernetes, infrastructure, secrets, health checks, rollback.

import { useState } from "react";
import {
  GitMerge, Container, Server, KeyRound, Activity, RotateCcw,
  CheckCircle, XCircle, Clock, Play, Loader2, Plus, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type PipelineStatus = "passing" | "failing" | "running" | "pending";
type ServiceHealth = "healthy" | "degraded" | "down";

interface Pipeline {
  id: string;
  name: string;
  status: PipelineStatus;
  branch: string;
  duration: string;
  triggeredBy: string;
}

interface Service {
  name: string;
  health: ServiceHealth;
  replicas: string;
  cpu: string;
  memory: string;
  uptime: string;
}

const PIPELINES: Pipeline[] = [
  { id: "1", name: "Deploy to Production", status: "passing", branch: "main", duration: "2m 34s", triggeredBy: "push" },
  { id: "2", name: "Run Test Suite",       status: "passing", branch: "main", duration: "4m 12s", triggeredBy: "push" },
  { id: "3", name: "Security Scan",        status: "failing", branch: "feat/auth", duration: "1m 08s", triggeredBy: "PR #42" },
  { id: "4", name: "Build Docker Image",   status: "running", branch: "main", duration: "0m 45s…", triggeredBy: "push" },
];

const SERVICES: Service[] = [
  { name: "api-gateway",   health: "healthy",  replicas: "3/3", cpu: "12%",  memory: "256MB", uptime: "14d" },
  { name: "auth-service",  health: "healthy",  replicas: "2/2", cpu: "8%",   memory: "128MB", uptime: "14d" },
  { name: "tmap-v2",       health: "degraded", replicas: "1/2", cpu: "78%",  memory: "512MB", uptime: "2d"  },
  { name: "redis-cache",   health: "healthy",  replicas: "1/1", cpu: "4%",   memory: "64MB",  uptime: "14d" },
];

const STATUS_ICON: Record<PipelineStatus, React.ElementType> = {
  passing: CheckCircle,
  failing: XCircle,
  running: Loader2,
  pending: Clock,
};

const STATUS_COLOR: Record<PipelineStatus, string> = {
  passing: "text-emerald-400",
  failing: "text-red-400",
  running: "text-blue-400 animate-spin",
  pending: "text-muted-foreground/60",
};

const HEALTH_COLOR: Record<ServiceHealth, string> = {
  healthy:  "bg-emerald-500",
  degraded: "bg-amber-500",
  down:     "bg-red-500",
};

interface DevOpsPanelProps {
  className?: string;
}

export function DevOpsPanel({ className }: DevOpsPanelProps) {
  const [activeTab, setActiveTab] = useState<"pipelines" | "services" | "secrets">("pipelines");
  const [generating, setGenerating] = useState(false);

  async function handleGeneratePipeline() {
    setGenerating(true);
    await new Promise((r) => setTimeout(r, 1800));
    setGenerating(false);
  }

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <GitMerge className="size-4 text-primary" />
          <span className="font-semibold text-foreground">AI DevOps</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={handleGeneratePipeline} disabled={generating} className="h-6 px-2 text-[10px] gap-1">
            {generating ? <Loader2 className="size-3 animate-spin" /> : <Zap className="size-3" />}
            Generate Pipeline
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2">
            <Plus className="size-3" />
          </Button>
        </div>
      </div>

      {/* Failing pipeline alert */}
      {PIPELINES.some((p) => p.status === "failing") && (
        <div className="flex items-center gap-2 border-b border-red-500/20 bg-red-500/5 px-4 py-2">
          <XCircle className="size-3 text-red-400 shrink-0" />
          <span className="text-[11px] text-red-400/90">
            Security Scan failing on feat/auth — AI suggests reviewing CVE-2024-1234 in jwt package
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border/40 bg-card/20">
        {(["pipelines", "services", "secrets"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setActiveTab(t)}
            className={cn("flex-1 py-2 text-[11px] font-medium capitalize transition-colors",
              activeTab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            {t === "pipelines" ? "CI/CD" : t === "services" ? "Services" : "Secrets"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {activeTab === "pipelines" && PIPELINES.map((p) => {
          const Icon = STATUS_ICON[p.status];
          return (
            <div key={p.id} className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 hover:bg-card/50 transition-colors">
              <div className="flex items-start gap-2">
                <Icon className={cn("mt-0.5 size-3.5 shrink-0", STATUS_COLOR[p.status])} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground">{p.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground/60">
                    <span className="font-mono">{p.branch}</span>
                    <span>·</span>
                    <span>{p.duration}</span>
                    <span>·</span>
                    <span>via {p.triggeredBy}</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" className="h-5 w-5 p-0">
                    <Play className="size-2.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-5 w-5 p-0">
                    <RotateCcw className="size-2.5" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}

        {activeTab === "services" && (
          <>
            {SERVICES.some((s) => s.health !== "healthy") && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 mb-2">
                <p className="text-[11px] text-amber-400">
                  AI detected: tmap-v2 replica count below target. Auto-scaling triggered.
                </p>
              </div>
            )}
            {SERVICES.map((s) => (
              <div key={s.name} className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 hover:bg-card/50 transition-colors">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={cn("size-2 rounded-full", HEALTH_COLOR[s.health])} />
                  <span className="font-mono font-medium text-foreground">{s.name}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground/60">{s.replicas} replicas</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px]">
                  {[["CPU", s.cpu], ["Memory", s.memory], ["Uptime", s.uptime]].map(([l, v]) => (
                    <div key={l} className="text-center">
                      <p className="text-muted-foreground/50">{l}</p>
                      <p className="font-medium text-foreground/80">{v}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full h-8 text-[11px] gap-2 mt-2">
              <RotateCcw className="size-3" /> Rollback to Previous Version
            </Button>
          </>
        )}

        {activeTab === "secrets" && (
          <div className="space-y-2">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <p className="text-[11px] text-amber-400">All secrets encrypted at rest. Rotation recommended for 2 keys older than 90 days.</p>
            </div>
            {["DATABASE_URL", "ANTHROPIC_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "VERCEL_TOKEN", "GITHUB_CLIENT_SECRET"].map((key, i) => (
              <div key={key} className="flex items-center justify-between rounded-xl border border-border/40 bg-card/30 px-3 py-2 hover:bg-card/50 transition-colors">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-3.5 text-muted-foreground/60" />
                  <span className="font-mono text-[11px] text-foreground/80">{key}</span>
                </div>
                <div className="flex items-center gap-2">
                  {i > 2 && <span className="text-[9px] text-amber-400 bg-amber-500/10 rounded px-1">Rotate</span>}
                  <span className="text-[10px] text-muted-foreground/40">••••••••</span>
                </div>
              </div>
            ))}
            <Button variant="outline" className="w-full h-7 text-[11px] gap-1.5 mt-1">
              <Plus className="size-3" /> Add Secret
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
