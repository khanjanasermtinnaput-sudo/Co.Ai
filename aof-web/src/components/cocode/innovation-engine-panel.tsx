"use client";

// Phase 97 — AI Innovation Engine
// Suggests innovation opportunities across every engineering domain.
// Evidence-based only — no recommendation without measurable value.

import { useState } from "react";
import { Lightbulb, Zap, TrendingUp, Cpu, Star, ChevronRight, CheckCircle, ThumbsUp, ThumbsDown, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

type InnovationDomain = "all" | "features" | "architecture" | "ai-workflows" | "performance" | "automation" | "dx";

interface Innovation {
  id: string;
  domain: Exclude<InnovationDomain, "all">;
  title: string;
  description: string;
  measurableValue: string;
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  novelty: "incremental" | "significant" | "breakthrough";
  evidence: string;
  suggestedBy: string;
  votes: number;
  status: "new" | "exploring" | "planned" | "dismissed";
}

const DOMAIN_CONFIG: Record<Exclude<InnovationDomain, "all">, { icon: React.ElementType; color: string; label: string }> = {
  features:      { icon: Star,       color: "text-primary",     label: "New Features"        },
  architecture:  { icon: Cpu,        color: "text-blue-400",    label: "Architecture"        },
  "ai-workflows":{ icon: Zap,        color: "text-purple-400",  label: "AI Workflows"        },
  performance:   { icon: TrendingUp, color: "text-emerald-400", label: "Performance"         },
  automation:    { icon: Cpu,        color: "text-cyan-400",    label: "Automation"          },
  dx:            { icon: CheckCircle,color: "text-amber-400",   label: "Developer Experience"},
};

const IMPACT_COLOR  = { low: "text-muted-foreground/50", medium: "text-blue-400", high: "text-primary"   };
const EFFORT_COLOR  = { low: "text-emerald-400",         medium: "text-amber-400", high: "text-red-400"  };
const NOVELTY_COLOR = { incremental: "text-muted-foreground/50", significant: "text-blue-400", breakthrough: "text-purple-400" };

const INNOVATIONS: Innovation[] = [
  {
    id: "1", domain: "ai-workflows", title: "AI Pair Programming with Voice",
    description: "Developer speaks a requirement, AI narrates its reasoning while writing code. Bidirectional voice → code → voice loop.",
    measurableValue: "+32% task completion speed (industry avg for voice-code pairs)",
    effort: "high", impact: "high", novelty: "breakthrough", votes: 47,
    evidence: "GitHub Next research shows voice-assisted coding reduces context switching by 40%. Web Speech API is GA.",
    suggestedBy: "AI Innovation Agent", status: "exploring",
  },
  {
    id: "2", domain: "features", title: "Inline Code Suggestion (Ghost Text)",
    description: "Like Copilot, but CoCode-specific: ghost text appears inline in Monaco based on file context, not just the cursor line.",
    measurableValue: "+28% developer velocity (Copilot benchmark data)",
    effort: "medium", impact: "high", novelty: "significant", votes: 82,
    evidence: "Most-cited competitor gap vs Cursor. Monaco supports decorations and ghost text via editor.decorations API.",
    suggestedBy: "Market Analysis Agent", status: "planned",
  },
  {
    id: "3", domain: "performance", title: "Predictive Code Prefetching",
    description: "When developer opens file A, CoCode predicts which files they'll open next (based on import graph) and pre-loads them into memory.",
    measurableValue: "File open latency: 340ms → <50ms for predicted files",
    effort: "medium", impact: "medium", novelty: "significant", votes: 23,
    evidence: "90% of file opens follow import chain. Import graph is already in repo-intel. Pre-fetching reduces perceived latency.",
    suggestedBy: "Performance Agent", status: "new",
  },
  {
    id: "4", domain: "architecture", title: "Edge-Native AI (Run Models at CDN Edge)",
    description: "Deploy fast models (Haiku, Phi-3) to Cloudflare Workers AI. Local classification and auto-complete without API round trip.",
    measurableValue: "Auto-complete latency: 600ms → 40ms",
    effort: "high", impact: "high", novelty: "breakthrough", votes: 31,
    evidence: "Cloudflare Workers AI supports Mistral-7B. Token classification tasks are viable at edge. TTFB reduces dramatically.",
    suggestedBy: "Architecture Evolution Agent", status: "new",
  },
  {
    id: "5", domain: "automation", title: "Zero-Effort PR Description Generation",
    description: "After every commit, AI generates PR title + body with diff summary, test coverage, risk assessment, and screenshots.",
    measurableValue: "PR review time −22% (teams that use AI PR descriptions)",
    effort: "low", impact: "medium", novelty: "incremental", votes: 55,
    evidence: "Phase 84 already produces diffs. Phase 94 logs actions. Combining both into PR template generation is low-lift.",
    suggestedBy: "Engineering Agent", status: "planned",
  },
  {
    id: "6", domain: "dx", title: "AI-Powered Error Explanation in Status Bar",
    description: "When TS error count appears in status bar, hover shows AI explanation of the top error and a one-click fix button.",
    measurableValue: "Error resolution time −45% (measured in JetBrains AI plugin)",
    effort: "low", impact: "medium", novelty: "incremental", votes: 38,
    evidence: "Status bar already shows error count. DiagnosticsPanel exists. Gap: quick-access from status bar without panel switch.",
    suggestedBy: "DX Agent", status: "new",
  },
  {
    id: "7", domain: "features", title: "Collaborative Real-Time Code Review",
    description: "Multiple reviewers annotate the same diff simultaneously. AI summarizes discussion and suggests final resolution.",
    measurableValue: "+18% review throughput in asynchronous teams",
    effort: "high", impact: "high", novelty: "significant", votes: 29,
    evidence: "Phase 72 has live cursors. Phase 84 has diffs. Merging both with a comment layer creates collaborative review.",
    suggestedBy: "Product Agent", status: "new",
  },
];

interface InnovationEnginePanelProps { className?: string }

export function InnovationEnginePanel({ className }: InnovationEnginePanelProps) {
  const [domain, setDomain] = useState<InnovationDomain>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [innovations, setInnovations] = useState(INNOVATIONS);

  const filtered = innovations.filter((inn) => domain === "all" || inn.domain === domain)
    .sort((a, b) => b.votes - a.votes);

  const breakthroughCount = innovations.filter((i) => i.novelty === "breakthrough" && i.status === "new").length;

  function vote(id: string, dir: 1 | -1) {
    setInnovations((prev) => prev.map((inn) => inn.id === id ? { ...inn, votes: inn.votes + dir } : inn));
  }

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Innovation Engine</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          {breakthroughCount > 0 && <span className="text-purple-400">{breakthroughCount} breakthrough ideas</span>}
          <span className="text-muted-foreground/40">Evidence-based only</span>
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-border/30 px-3 py-1.5 no-scrollbar">
        <button type="button" onClick={() => setDomain("all")}
          className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
            domain === "all" ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-foreground")}>All</button>
        {(Object.keys(DOMAIN_CONFIG) as Exclude<InnovationDomain, "all">[]).map((d) => (
          <button key={d} type="button" onClick={() => setDomain(d)}
            className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
              domain === d ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-foreground")}>
            {DOMAIN_CONFIG[d].label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filtered.map((inn) => {
          const cfg = DOMAIN_CONFIG[inn.domain];
          const Icon = cfg.icon;
          const isExpanded = expanded === inn.id;
          return (
            <div key={inn.id} className="rounded-xl border border-border/40 bg-card/30 overflow-hidden hover:bg-card/50 transition-colors">
              <button type="button" onClick={() => setExpanded(isExpanded ? null : inn.id)}
                className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left">
                <Icon className={cn("size-3.5 shrink-0 mt-0.5", cfg.color)} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground leading-tight">{inn.title}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px]">
                    <span className={NOVELTY_COLOR[inn.novelty]}>{inn.novelty}</span>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="text-muted-foreground/50">Impact: <span className={IMPACT_COLOR[inn.impact]}>{inn.impact}</span></span>
                    <span className="text-muted-foreground/30">·</span>
                    <span className="text-muted-foreground/50">Effort: <span className={EFFORT_COLOR[inn.effort]}>{inn.effort}</span></span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-semibold text-muted-foreground/50">{inn.votes}</span>
                  <ChevronRight className={cn("size-3.5 text-muted-foreground/40 transition-transform", isExpanded && "rotate-90")} />
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-border/20 px-3 py-3 space-y-2.5">
                  <p className="text-[11px] text-muted-foreground/80 leading-relaxed">{inn.description}</p>

                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
                    <p className="text-[9px] text-emerald-400/60 mb-0.5">Measurable Value</p>
                    <p className="text-[10px] text-muted-foreground/80 font-medium">{inn.measurableValue}</p>
                  </div>

                  <div>
                    <p className="text-[9px] font-semibold text-muted-foreground/40 mb-1">Evidence</p>
                    <p className="text-[10px] text-muted-foreground/70 leading-relaxed">{inn.evidence}</p>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex gap-1">
                      <button type="button" onClick={() => vote(inn.id, 1)}
                        className="flex items-center gap-1 rounded-lg border border-border/40 px-2 py-1 text-[10px] text-muted-foreground/60 hover:text-emerald-400 hover:border-emerald-500/30 transition-colors">
                        <ThumbsUp className="size-3" /> Useful
                      </button>
                      <button type="button" onClick={() => vote(inn.id, -1)}
                        className="flex items-center gap-1 rounded-lg border border-border/40 px-2 py-1 text-[10px] text-muted-foreground/60 hover:text-red-400 hover:border-red-500/30 transition-colors">
                        <ThumbsDown className="size-3" /> Skip
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/40">
                      <BarChart3 className="size-3" /> {inn.votes} votes · {inn.suggestedBy}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
