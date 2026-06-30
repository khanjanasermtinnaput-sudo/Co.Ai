"use client";

// Phase 92 — Business Requirement Intelligence
// AI understands business goals, not just code.
// Aligns engineering priorities with revenue, retention, and market signals.

import { useState } from "react";
import { Briefcase, TrendingUp, TrendingDown, Users, DollarSign, Target, Search, Star, AlertTriangle, CheckCircle, BarChart3, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

type ReqCategory = "all" | "customer" | "revenue" | "retention" | "roadmap" | "market";

interface BizRequirement {
  id: string;
  category: Exclude<ReqCategory, "all">;
  title: string;
  source: string;
  priority: "critical" | "high" | "medium" | "low";
  revenueImpact: string;
  retentionImpact: string;
  engineeringEstimate: string;
  status: "backlog" | "in-progress" | "done";
  aiInsight: string;
}

interface MarketSignal {
  type: "opportunity" | "threat" | "trend";
  title: string;
  body: string;
  source: string;
  relevance: "high" | "medium" | "low";
}

const CAT_CONFIG: Record<Exclude<ReqCategory, "all">, { icon: React.ElementType; color: string; label: string }> = {
  customer:  { icon: Users,       color: "text-blue-400",    label: "Customer Feedback" },
  revenue:   { icon: DollarSign,  color: "text-emerald-400", label: "Revenue Impact"    },
  retention: { icon: Star,        color: "text-purple-400",  label: "User Retention"    },
  roadmap:   { icon: Target,      color: "text-primary",     label: "Product Roadmap"   },
  market:    { icon: Globe,       color: "text-cyan-400",    label: "Market Trends"     },
};

const PRIORITY_COLOR = { critical: "text-red-400", high: "text-amber-400", medium: "text-blue-400", low: "text-muted-foreground/50" };
const PRIORITY_BG    = { critical: "bg-red-500/10 border-red-500/20", high: "bg-amber-500/10 border-amber-500/20", medium: "bg-blue-500/10 border-blue-500/20", low: "bg-muted/10 border-border/20" };

const REQUIREMENTS: BizRequirement[] = [
  {
    id: "1", category: "revenue", title: "Enterprise SSO (SAML/OIDC)",
    source: "Sales team · 12 enterprise leads blocked",
    priority: "critical", revenueImpact: "+$48k MRR potential", retentionImpact: "Prevents 12 churn risks",
    engineeringEstimate: "3 sprints", status: "in-progress",
    aiInsight: "Highest unblocked revenue opportunity. 12 enterprise leads cited SSO as blocker. Every sprint of delay costs ~$4k MRR.",
  },
  {
    id: "2", category: "customer", title: "Offline Mode for Editor",
    source: "UserVoice · 847 upvotes",
    priority: "high", revenueImpact: "+$8k MRR (mobile/laptop users)", retentionImpact: "+15% session length",
    engineeringEstimate: "2 sprints", status: "backlog",
    aiInsight: "Top-voted feature for 6 months. Users report dropping sessions when internet is unstable. Service Worker + IndexedDB approach feasible.",
  },
  {
    id: "3", category: "retention", title: "Onboarding Tutorial Flow",
    source: "Analytics · 68% drop-off at step 3",
    priority: "high", revenueImpact: "+$12k MRR (trial→paid conversion)", retentionImpact: "+22% D7 retention predicted",
    engineeringEstimate: "1 sprint", status: "backlog",
    aiInsight: "68% of new users drop at the GitHub connect step. Simplifying to optional or adding a demo repo would unblock conversion.",
  },
  {
    id: "4", category: "roadmap", title: "Multi-workspace Support",
    source: "Product roadmap Q3 2025",
    priority: "medium", revenueImpact: "+$18k MRR (agency tier)", retentionImpact: "Enables team accounts",
    engineeringEstimate: "4 sprints", status: "backlog",
    aiInsight: "Required for agency and team pricing tiers. Architecture currently assumes single-workspace — requires Supabase schema migration.",
  },
  {
    id: "5", category: "market", title: "AI Code Generation (Cursor competitor)",
    source: "Market research · Cursor at 500k MAU",
    priority: "high", revenueImpact: "Defensive — prevents user loss", retentionImpact: "Critical for developer segment",
    engineeringEstimate: "Ongoing (Phase 84 covers this)", status: "in-progress",
    aiInsight: "Cursor's inline code generation is the most-cited competitor feature. Our Phase 84 autonomous refactor engine addresses this directly.",
  },
  {
    id: "6", category: "customer", title: "Dark/Light Theme Persistence",
    source: "Support tickets · 43 in last 30 days",
    priority: "low", revenueImpact: "Indirect — reduces friction", retentionImpact: "Reduces support burden",
    engineeringEstimate: "0.5 sprint", status: "done",
    aiInsight: "Already addressed in ui-store.ts persist middleware. Support tickets should decrease next cycle.",
  },
];

const MARKET_SIGNALS: MarketSignal[] = [
  { type: "threat",      title: "Cursor raised $60M Series B",        source: "TechCrunch",      relevance: "high",   body: "Cursor is accelerating investment in inline AI code editing. Their inline generation is our most-cited competitor gap." },
  { type: "opportunity", title: "GitHub Copilot removed from VSCode",  source: "HN / GitHub",     relevance: "high",   body: "Developer frustration with Copilot quality opened a window for CoCode's more context-aware approach." },
  { type: "trend",       title: "AI-first dev tools adoption +340% YoY",source: "Stack Overflow", relevance: "medium", body: "Developers are actively switching to AI-first tools. Window for new platform dominance is open now." },
];

interface BizRequirementsPanelProps { className?: string }

export function BizRequirementsPanel({ className }: BizRequirementsPanelProps) {
  const [category, setCategory] = useState<ReqCategory>("all");
  const [view, setView] = useState<"requirements" | "market">("requirements");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = REQUIREMENTS.filter((r) =>
    (category === "all" || r.category === category) && r.status !== "done"
  );
  const criticalCount = REQUIREMENTS.filter((r) => r.priority === "critical" && r.status !== "done").length;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Briefcase className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Business Requirements</span>
        </div>
        {criticalCount > 0 && (
          <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] text-red-400">{criticalCount} critical</span>
        )}
      </div>

      <div className="flex items-center justify-between border-b border-border/40 bg-card/20 px-3 py-1.5">
        <div className="flex">
          {(["requirements", "market"] as const).map((v) => (
            <button key={v} type="button" onClick={() => setView(v)}
              className={cn("px-3 py-1.5 text-[11px] font-medium capitalize transition-colors",
                view === v ? "border-b-2 border-primary text-primary" : "text-muted-foreground hover:text-foreground")}>
              {v === "requirements" ? "Requirements" : "Market Signals"}
            </button>
          ))}
        </div>
      </div>

      {view === "requirements" && (
        <>
          <div className="flex items-center gap-1 overflow-x-auto border-b border-border/30 px-3 py-1.5 no-scrollbar">
            <button type="button" onClick={() => setCategory("all")}
              className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                category === "all" ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-foreground")}>All</button>
            {(Object.keys(CAT_CONFIG) as Exclude<ReqCategory, "all">[]).map((cat) => (
              <button key={cat} type="button" onClick={() => setCategory(cat)}
                className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                  category === cat ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-foreground")}>
                {CAT_CONFIG[cat].label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {filtered.map((req) => {
              const catCfg = CAT_CONFIG[req.category];
              const CatIcon = catCfg.icon;
              const isExpanded = expanded === req.id;
              return (
                <div key={req.id} className={cn("rounded-xl border overflow-hidden", PRIORITY_BG[req.priority])}>
                  <button type="button" onClick={() => setExpanded(isExpanded ? null : req.id)}
                    className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left">
                    <CatIcon className={cn("size-3.5 shrink-0 mt-0.5", catCfg.color)} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground leading-tight">{req.title}</p>
                      <p className="text-[10px] text-muted-foreground/50 mt-0.5">{req.source}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={cn("text-[9px] font-bold capitalize", PRIORITY_COLOR[req.priority])}>{req.priority}</span>
                      {req.status === "in-progress" && <span className="text-[9px] text-primary bg-primary/10 rounded-full px-1.5 py-0.5">in progress</span>}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border/20 px-3 py-3 space-y-2.5">
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { label: "Revenue", value: req.revenueImpact, color: "text-emerald-400" },
                          { label: "Retention", value: req.retentionImpact, color: "text-purple-400" },
                          { label: "Effort", value: req.engineeringEstimate, color: "text-primary" },
                        ].map((m) => (
                          <div key={m.label} className="rounded-lg border border-border/30 bg-card/30 px-2 py-1.5 text-center">
                            <p className="text-[9px] text-muted-foreground/40">{m.label}</p>
                            <p className={cn("text-[10px] font-semibold leading-tight mt-0.5", m.color)}>{m.value}</p>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2">
                        <p className="text-[9px] text-primary/60 mb-0.5">AI Insight</p>
                        <p className="text-[10px] text-muted-foreground/80 leading-relaxed">{req.aiInsight}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {view === "market" && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {MARKET_SIGNALS.map((sig, i) => {
            const typeColor = sig.type === "threat" ? "text-red-400 border-red-500/20 bg-red-500/5" : sig.type === "opportunity" ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5" : "text-blue-400 border-blue-500/20 bg-blue-500/5";
            return (
              <div key={i} className={cn("rounded-xl border px-3 py-2.5", typeColor)}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={cn("text-[9px] font-bold uppercase rounded-full px-1.5 py-0.5 border", typeColor)}>{sig.type}</span>
                  <span className="text-[9px] text-muted-foreground/40 ml-auto">{sig.source}</span>
                </div>
                <p className="font-medium text-foreground mb-1 leading-tight">{sig.title}</p>
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">{sig.body}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
