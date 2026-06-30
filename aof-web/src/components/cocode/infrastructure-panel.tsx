"use client";

// Phase 76 — Infrastructure Intelligence
// Visualize cloud infrastructure: services, dependencies, network topology.

import { useState } from "react";
import { Server, Database, Globe, Box, ArrowRight, CheckCircle, AlertTriangle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type NodeType = "frontend" | "api" | "database" | "cache" | "cdn" | "queue" | "external";

interface InfraNode {
  id: string;
  label: string;
  type: NodeType;
  provider: string;
  status: "healthy" | "degraded" | "down";
  region?: string;
  cost?: string;
}

interface InfraEdge {
  from: string;
  to: string;
  label?: string;
  latency?: string;
}

const NODES: InfraNode[] = [
  { id: "vercel",     label: "aof-web",      type: "frontend",  provider: "Vercel",    status: "healthy",  region: "US East",   cost: "$20/mo"  },
  { id: "railway",    label: "tmap-v2",      type: "api",       provider: "Railway",   status: "degraded", region: "US East",   cost: "$15/mo"  },
  { id: "supabase",   label: "Supabase DB",  type: "database",  provider: "Supabase",  status: "healthy",  region: "US East",   cost: "$25/mo"  },
  { id: "redis",      label: "Redis Cache",  type: "cache",     provider: "Railway",   status: "healthy",  region: "US East",   cost: "$5/mo"   },
  { id: "cloudflare", label: "CDN",          type: "cdn",       provider: "Cloudflare",status: "healthy",  region: "Global",    cost: "$0/mo"   },
  { id: "anthropic",  label: "Claude API",   type: "external",  provider: "Anthropic", status: "healthy",                       cost: "Usage"   },
];

const EDGES: InfraEdge[] = [
  { from: "cloudflare", to: "vercel",   label: "HTTP",   latency: "12ms" },
  { from: "vercel",     to: "railway",  label: "API",    latency: "28ms" },
  { from: "railway",    to: "supabase", label: "SQL",    latency: "8ms"  },
  { from: "railway",    to: "redis",    label: "Cache",  latency: "2ms"  },
  { from: "railway",    to: "anthropic",label: "AI API", latency: "320ms"},
];

const TYPE_ICON: Record<NodeType, React.ElementType> = {
  frontend: Globe,
  api:      Server,
  database: Database,
  cache:    Zap,
  cdn:      Globe,
  queue:    Box,
  external: ArrowRight,
};

const TYPE_COLOR: Record<NodeType, string> = {
  frontend: "border-blue-500/40 bg-blue-500/10",
  api:      "border-primary/40 bg-primary/10",
  database: "border-emerald-500/40 bg-emerald-500/10",
  cache:    "border-purple-500/40 bg-purple-500/10",
  cdn:      "border-sky-500/40 bg-sky-500/10",
  queue:    "border-amber-500/40 bg-amber-500/10",
  external: "border-border/40 bg-card/30",
};

const STATUS_INDICATOR: Record<string, string> = {
  healthy:  "bg-emerald-500",
  degraded: "bg-amber-500",
  down:     "bg-red-500",
};

interface InfrastructurePanelProps {
  className?: string;
}

export function InfrastructurePanel({ className }: InfrastructurePanelProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");

  const totalCost = "$65/mo";
  const selectedNode = NODES.find((n) => n.id === selected);
  const nodeEdges = selected ? EDGES.filter((e) => e.from === selected || e.to === selected) : [];

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Server className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Infrastructure</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground/60">{totalCost} total</span>
          <div className="flex rounded-lg border border-border/40 overflow-hidden">
            {(["graph", "list"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={cn("px-2 py-1 text-[10px] font-medium capitalize transition-colors",
                  view === v ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Degraded alert */}
      {NODES.some((n) => n.status === "degraded") && (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/5 px-4 py-2">
          <AlertTriangle className="size-3 text-amber-400 shrink-0" />
          <span className="text-[11px] text-amber-400/90">tmap-v2 degraded — 1 of 2 replicas offline. AI suggests increasing Railway resources.</span>
        </div>
      )}

      <div className="flex-1 overflow-hidden flex flex-col">
        {view === "graph" ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Connection flow */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Service Topology</p>
              {EDGES.map((edge, i) => {
                const fromNode = NODES.find((n) => n.id === edge.from);
                const toNode   = NODES.find((n) => n.id === edge.to);
                if (!fromNode || !toNode) return null;
                return (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-border/30 bg-card/20 px-3 py-2">
                    <span className="font-mono text-[11px] text-foreground/80">{fromNode.label}</span>
                    <div className="flex-1 flex items-center gap-1">
                      <div className="flex-1 border-t border-dashed border-border/50" />
                      <span className="text-[9px] text-muted-foreground/50">{edge.label}</span>
                      <div className="flex-1 border-t border-dashed border-border/50" />
                      <ArrowRight className="size-2.5 text-muted-foreground/40" />
                    </div>
                    <span className="font-mono text-[11px] text-foreground/80">{toNode.label}</span>
                    {edge.latency && (
                      <span className={cn("text-[9px] font-medium", parseInt(edge.latency) > 200 ? "text-amber-400" : "text-emerald-400")}>
                        {edge.latency}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {NODES.map((node) => {
              const Icon = TYPE_ICON[node.type];
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setSelected(selected === node.id ? null : node.id)}
                  className={cn(
                    "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                    selected === node.id ? "border-primary/40 bg-primary/5" : cn(TYPE_COLOR[node.type], "hover:opacity-80"),
                  )}
                >
                  <div className="flex items-center gap-2">
                    <div className={cn("size-1.5 rounded-full shrink-0", STATUS_INDICATOR[node.status])} />
                    <Icon className="size-3.5 shrink-0 text-muted-foreground/70" />
                    <span className="font-mono font-medium text-foreground">{node.label}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground/50">{node.provider}</span>
                  </div>
                  {selected === node.id && (
                    <div className="mt-2 pt-2 border-t border-border/30 grid grid-cols-2 gap-1.5">
                      {node.region && <div className="text-[10px]"><span className="text-muted-foreground/50">Region: </span><span className="text-foreground/70">{node.region}</span></div>}
                      {node.cost && <div className="text-[10px]"><span className="text-muted-foreground/50">Cost: </span><span className="text-foreground/70">{node.cost}</span></div>}
                      <div className="text-[10px]"><span className="text-muted-foreground/50">Status: </span><span className={node.status === "healthy" ? "text-emerald-400" : "text-amber-400"}>{node.status}</span></div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Dependencies of selected */}
        {selected && nodeEdges.length > 0 && (
          <div className="border-t border-border/40 bg-card/20 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2">Connections for {selectedNode?.label}</p>
            <div className="space-y-1">
              {nodeEdges.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground/70">
                  <ArrowRight className="size-3 text-muted-foreground/30" />
                  <span>{e.from === selected ? `→ ${NODES.find((n) => n.id === e.to)?.label}` : `← ${NODES.find((n) => n.id === e.from)?.label}`}</span>
                  <span className="ml-auto font-mono text-[10px]">{e.latency}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
