"use client";

// Phase 99 — Engineering Intelligence Network
// Connect multiple CoCode instances for org-wide knowledge sharing.
// Architecture templates, reusable patterns, shared components, AI memories,
// benchmarking, and best-practice library. Privacy boundaries always enforced.

import { useState } from "react";
import { Network, Building, Lock, CheckCircle, Star, GitMerge, Layers, Search, TrendingUp, Users, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

type NetworkView = "instances" | "patterns" | "benchmarks" | "library";

interface NetworkInstance {
  id: string;
  org: string;
  plan: "startup" | "professional" | "enterprise";
  instances: number;
  engineers: number;
  connected: boolean;
  sharingEnabled: boolean;
  contribution: "high" | "medium" | "low";
}

interface SharedPattern {
  id: string;
  title: string;
  category: "architecture" | "security" | "performance" | "testing" | "ci-cd" | "database";
  usedBy: number;
  rating: number;
  description: string;
  author: string;
  verified: boolean;
}

interface Benchmark {
  metric: string;
  yourValue: string;
  networkMedian: string;
  networkTop10: string;
  trend: "up" | "down" | "stable";
  unit: string;
}

const INSTANCES: NetworkInstance[] = [
  { id: "1", org: "Your Org (Co.Ai)", plan: "professional", instances: 1, engineers: 1, connected: true, sharingEnabled: true, contribution: "high" },
  { id: "2", org: "Startup A (anonymous)", plan: "startup",   instances: 1, engineers: 3, connected: true, sharingEnabled: true, contribution: "medium" },
  { id: "3", org: "Agency B (anonymous)", plan: "professional",instances: 4, engineers: 12, connected: true, sharingEnabled: true, contribution: "high" },
  { id: "4", org: "Enterprise C (anonymous)", plan: "enterprise", instances: 20, engineers: 80, connected: true, sharingEnabled: false, contribution: "low" },
];

const PATTERNS: SharedPattern[] = [
  { id: "1", title: "Next.js + Supabase RLS Auth Pattern",    category: "security",     usedBy: 847,  rating: 4.9, verified: true,  author: "Network verified", description: "Row-Level Security setup with server-side auth helpers, middleware guard, and refresh token rotation. Battle-tested across 847 projects." },
  { id: "2", title: "SSE Streaming API Route Pattern",        category: "architecture", usedBy: 512,  rating: 4.8, verified: true,  author: "Network verified", description: "Server-Sent Events with ReadableStream, heartbeat, error recovery, and client reconnect logic for streaming AI responses." },
  { id: "3", title: "Zustand + Persist + Selectors Pattern",  category: "architecture", usedBy: 1203, rating: 4.9, verified: true,  author: "Network verified", description: "Fine-grained selector pattern with subscribeWithSelector middleware. Prevents unnecessary re-renders at scale." },
  { id: "4", title: "CI/CD with Auto-Rollback on P99 Spike",  category: "ci-cd",        usedBy: 234,  rating: 4.7, verified: true,  author: "Community",        description: "GitHub Actions workflow that monitors P99 latency post-deploy and triggers automatic rollback if threshold exceeded." },
  { id: "5", title: "Database Migration Safety Checklist",    category: "database",     usedBy: 389,  rating: 4.8, verified: true,  author: "Network verified", description: "12-point checklist for zero-downtime Postgres migrations: index concurrently, backfill in batches, test on prod copy first." },
  { id: "6", title: "E2E Test Isolation with TestContainers", category: "testing",      usedBy: 178,  rating: 4.6, verified: false, author: "Community",        description: "Hermetic E2E tests using Docker TestContainers for real DB and real LLM stubs. Eliminates flakiness from shared test state." },
];

const BENCHMARKS: Benchmark[] = [
  { metric: "AI response P50 latency",    yourValue: "1.2s",   networkMedian: "1.4s",   networkTop10: "0.8s",   trend: "up",     unit: "sec"  },
  { metric: "Test coverage",              yourValue: "68%",    networkMedian: "61%",    networkTop10: "85%",    trend: "stable", unit: "%"    },
  { metric: "PR merge time",              yourValue: "6.2h",   networkMedian: "8.1h",   networkTop10: "3.4h",   trend: "up",     unit: "hrs"  },
  { metric: "Build time",                 yourValue: "48s",    networkMedian: "62s",    networkTop10: "28s",    trend: "stable", unit: "sec"  },
  { metric: "Deploy frequency",           yourValue: "3.2/week",networkMedian: "2.1/wk",networkTop10: "8.4/wk", trend: "up",    unit: "/wk"  },
  { metric: "Tech debt ratio",            yourValue: "8.2%",   networkMedian: "14.1%",  networkTop10: "3.8%",   trend: "down",   unit: "%"    },
  { metric: "AI task acceptance rate",    yourValue: "71%",    networkMedian: "58%",    networkTop10: "82%",    trend: "up",     unit: "%"    },
];

const CAT_COLOR: Record<SharedPattern["category"], string> = {
  architecture: "text-primary",     security:    "text-red-400",
  performance:  "text-emerald-400", testing:     "text-yellow-400",
  "ci-cd":      "text-blue-400",    database:    "text-cyan-400",
};

interface IntelNetworkPanelProps { className?: string }

export function IntelNetworkPanel({ className }: IntelNetworkPanelProps) {
  const [view, setView] = useState<NetworkView>("patterns");
  const [search, setSearch] = useState("");

  const filteredPatterns = PATTERNS.filter((p) => !search || p.title.toLowerCase().includes(search.toLowerCase()) || p.category.toLowerCase().includes(search.toLowerCase()));
  const connectedCount = INSTANCES.filter((i) => i.connected).length;
  const totalEngineers = INSTANCES.filter((i) => i.connected).reduce((a, i) => a + i.engineers, 0);

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Intelligence Network</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-emerald-400">{connectedCount} instances</span>
          <span className="text-muted-foreground/40">{totalEngineers} engineers</span>
        </div>
      </div>

      <div className="flex border-b border-border/40 bg-card/20 overflow-x-auto no-scrollbar">
        {([
          { key: "patterns",   label: "Patterns"   },
          { key: "benchmarks", label: "Benchmarks" },
          { key: "instances",  label: "Network"    },
          { key: "library",    label: "Library"    },
        ] as { key: NetworkView; label: string }[]).map((t) => (
          <button key={t.key} type="button" onClick={() => setView(t.key)}
            className={cn("shrink-0 px-3 py-2 text-[11px] font-medium transition-colors",
              view === t.key ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>

      {view === "patterns" && (
        <>
          <div className="border-b border-border/30 px-3 py-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/40" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search shared patterns…"
                className="w-full rounded-lg border border-border/40 bg-white/[0.02] py-1.5 pl-7 pr-3 text-[11px] outline-none focus:border-primary/30 placeholder:text-muted-foreground/30" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filteredPatterns.map((pattern) => (
              <div key={pattern.id} className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 hover:bg-card/50 transition-colors">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={cn("text-[9px] font-semibold uppercase rounded-full px-1.5 py-0.5 border border-current/20", CAT_COLOR[pattern.category])}>{pattern.category}</span>
                  {pattern.verified && <Shield className="size-3 text-emerald-400" />}
                  <span className="ml-auto flex items-center gap-0.5 text-[10px] text-amber-400"><Star className="size-2.5 fill-amber-400" />{pattern.rating}</span>
                  <span className="text-[10px] text-muted-foreground/40">{pattern.usedBy} orgs</span>
                </div>
                <p className="font-medium text-foreground mb-1 leading-tight">{pattern.title}</p>
                <p className="text-[10px] text-muted-foreground/60 leading-relaxed">{pattern.description}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {view === "benchmarks" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 mb-1">
            <p className="text-[10px] text-primary/80">Your performance vs {connectedCount} network instances. Data is fully anonymized.</p>
          </div>
          {BENCHMARKS.map((b) => {
            const yourNum = parseFloat(b.yourValue);
            const medianNum = parseFloat(b.networkMedian);
            const isGood = b.trend === "up" ? yourNum <= medianNum : yourNum >= medianNum;
            return (
              <div key={b.metric} className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5">
                <p className="font-medium text-foreground mb-2">{b.metric}</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "You",      value: b.yourValue,      color: "text-primary"           },
                    { label: "Network",  value: b.networkMedian,  color: "text-muted-foreground/70"},
                    { label: "Top 10%",  value: b.networkTop10,   color: "text-emerald-400"       },
                  ].map((col) => (
                    <div key={col.label} className="rounded-lg border border-border/30 bg-card/30 px-1.5 py-1.5">
                      <p className="text-[9px] text-muted-foreground/40">{col.label}</p>
                      <p className={cn("font-mono font-semibold text-[11px]", col.color)}>{col.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === "instances" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 mb-1 flex items-center gap-2">
            <Lock className="size-3 text-amber-400 shrink-0" />
            <p className="text-[10px] text-amber-400/80">All instances are anonymized. No code, IP, or business data is shared. Only aggregated metrics and opt-in patterns.</p>
          </div>
          {INSTANCES.map((inst) => (
            <div key={inst.id} className={cn("rounded-xl border px-3 py-2.5",
              inst.id === "1" ? "border-primary/30 bg-primary/5" : "border-border/40 bg-card/30")}>
              <div className="flex items-center gap-2 mb-1">
                <Building className="size-3.5 text-muted-foreground/60 shrink-0" />
                <span className="font-medium text-foreground flex-1">{inst.org}</span>
                {inst.connected && <CheckCircle className="size-3 text-emerald-400 shrink-0" />}
              </div>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
                <span className="capitalize">{inst.plan}</span>
                <span>{inst.engineers} engineers</span>
                <span>{inst.sharingEnabled ? "Sharing ON" : "Sharing OFF"}</span>
                <span className={cn("ml-auto font-semibold", inst.contribution === "high" ? "text-emerald-400" : inst.contribution === "medium" ? "text-amber-400" : "text-muted-foreground/40")}>
                  {inst.contribution} contributor
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "library" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <p className="text-[10px] text-muted-foreground/40 px-1 pb-1">Best practices curated from network patterns with highest adoption and rating.</p>
          {[
            { title: "Zero-Downtime Deploy Checklist",     items: 12, category: "DevOps"       },
            { title: "API Design Guidelines",              items: 24, category: "Architecture" },
            { title: "Security Hardening Checklist",       items: 18, category: "Security"     },
            { title: "Database Query Performance Guide",   items: 9,  category: "Database"     },
            { title: "AI Integration Best Practices",      items: 15, category: "AI/ML"        },
            { title: "Accessibility Standards Checklist",  items: 22, category: "A11y"         },
          ].map((entry) => (
            <div key={entry.title} className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 hover:bg-card/50 transition-colors flex items-center gap-3">
              <Layers className="size-3.5 text-primary/60 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-foreground">{entry.title}</p>
                <p className="text-[10px] text-muted-foreground/50">{entry.items} guidelines · {entry.category}</p>
              </div>
              <TrendingUp className="size-3 text-emerald-400/60" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
