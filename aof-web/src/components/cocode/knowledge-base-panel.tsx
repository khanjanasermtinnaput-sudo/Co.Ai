"use client";

// Phase 82 — Engineering Knowledge Base
// Living system — every entry linked to real source files, auto-updated after approved changes.

import { useState } from "react";
import { BookOpen, FileCode, Search, Plus, RefreshCw, CheckCircle, Clock, Link } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type KBCategory =
  | "architecture" | "business-rules" | "api" | "coding" | "database"
  | "ui" | "testing" | "deployment" | "security" | "guidelines";

interface KBEntry {
  id: string;
  title: string;
  category: KBCategory;
  summary: string;
  sourceFile?: string;
  lastUpdated: string;
  autoSynced: boolean;
  tags: string[];
}

const CAT_LABEL: Record<KBCategory, string> = {
  architecture:   "Architecture",
  "business-rules":"Business Rules",
  api:            "API Standards",
  coding:         "Coding Standards",
  database:       "Database",
  ui:             "UI Standards",
  testing:        "Testing",
  deployment:     "Deployment",
  security:       "Security",
  guidelines:     "Guidelines",
};

const CAT_COLOR: Record<KBCategory, string> = {
  architecture:   "text-blue-400 bg-blue-500/10",
  "business-rules":"text-purple-400 bg-purple-500/10",
  api:            "text-emerald-400 bg-emerald-500/10",
  coding:         "text-primary bg-primary/10",
  database:       "text-cyan-400 bg-cyan-500/10",
  ui:             "text-pink-400 bg-pink-500/10",
  testing:        "text-yellow-400 bg-yellow-500/10",
  deployment:     "text-orange-400 bg-orange-500/10",
  security:       "text-red-400 bg-red-500/10",
  guidelines:     "text-muted-foreground bg-muted/20",
};

const KB_ENTRIES: KBEntry[] = [
  {
    id: "1", category: "architecture", title: "Monorepo Structure",
    summary: "aof-web (Next.js 14), tmap-v2 (Express), coagentix-cli share common types via /lib/types.ts. Never duplicate types.",
    sourceFile: "src/lib/types.ts", lastUpdated: "2d ago", autoSynced: true,
    tags: ["monorepo", "structure", "types"],
  },
  {
    id: "2", category: "coding", title: "Zustand Selector Pattern",
    summary: "Always use fine-grained selectors: useStore(s => s.field). Never destructure the whole store — causes full re-renders.",
    sourceFile: "src/store/cocode-ide-store.ts", lastUpdated: "1w ago", autoSynced: true,
    tags: ["zustand", "performance", "react"],
  },
  {
    id: "3", category: "api", title: "SSE Streaming Standard",
    summary: "All AI responses use Server-Sent Events via /api/chat. Client uses ReadableStream decoder. Abort via AbortController.",
    sourceFile: "src/lib/api.ts", lastUpdated: "5d ago", autoSynced: true,
    tags: ["sse", "streaming", "api"],
  },
  {
    id: "4", category: "security", title: "API Key Encryption",
    summary: "All provider API keys encrypted with AES-256-GCM before storing in Supabase. Never log decrypted keys.",
    sourceFile: "src/lib/server/ai-providers.ts", lastUpdated: "1w ago", autoSynced: true,
    tags: ["encryption", "keys", "supabase"],
  },
  {
    id: "5", category: "database", title: "Row-Level Security",
    summary: "All Supabase tables use RLS. User can only read/write their own rows. Service role key bypasses RLS on server only.",
    sourceFile: "supabase/migrations/", lastUpdated: "2w ago", autoSynced: true,
    tags: ["rls", "supabase", "security"],
  },
  {
    id: "6", category: "ui", title: "Design Tokens",
    summary: "Colors via HSL CSS variables in globals.css. Primary: #D97706 (amber). Dark-first. Use Tailwind semantic classes only.",
    sourceFile: "src/app/globals.css", lastUpdated: "3d ago", autoSynced: true,
    tags: ["design-system", "tokens", "tailwind"],
  },
  {
    id: "7", category: "testing", title: "Test Hermetic Mode",
    summary: "Tests are non-hermetic by default (load .env → real LLM calls). Use DOTENV_CONFIG_PATH for hermetic test runs.",
    sourceFile: "tmap-v2/config.ts", lastUpdated: "4d ago", autoSynced: false,
    tags: ["testing", "hermetic", "env"],
  },
  {
    id: "8", category: "deployment", title: "Railway Deployment",
    summary: "tmap-v2 deploys to Railway. Health check: GET /api/health. Auto-restart on crash. Env vars set in Railway dashboard.",
    sourceFile: "railway.toml", lastUpdated: "1w ago", autoSynced: true,
    tags: ["railway", "deployment", "health"],
  },
  {
    id: "9", category: "business-rules", title: "User Tier Access",
    summary: "GUEST (3 msgs) → FREE → LITE → PRO → ADVANCED. Feature gates checked via checkUserAccess(feature, tier). Never expose keys to GUEST.",
    sourceFile: "src/lib/types.ts", lastUpdated: "5d ago", autoSynced: true,
    tags: ["tiers", "access", "billing"],
  },
];

interface KnowledgeBasePanelProps { className?: string }

export function KnowledgeBasePanel({ className }: KnowledgeBasePanelProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<KBCategory | "all">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = KB_ENTRIES.filter((e) => {
    const matchCat = activeCategory === "all" || e.category === activeCategory;
    const matchSearch = !search ||
      e.title.toLowerCase().includes(search.toLowerCase()) ||
      e.summary.toLowerCase().includes(search.toLowerCase()) ||
      e.tags.some((t) => t.includes(search.toLowerCase()));
    return matchCat && matchSearch;
  });

  const categories = [...new Set(KB_ENTRIES.map((e) => e.category))];

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-primary" />
          <span className="font-semibold text-foreground">Knowledge Base</span>
          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">{KB_ENTRIES.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="h-6 px-2 gap-1 text-[10px]">
            <RefreshCw className="size-3" /> Sync
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
            <Plus className="size-3" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="border-b border-border/30 px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search knowledge…"
            className="w-full rounded-lg border border-border/40 bg-white/[0.02] py-1.5 pl-7 pr-3 text-[11px] outline-none focus:border-primary/30 placeholder:text-muted-foreground/30"
          />
        </div>
      </div>

      {/* Category filter */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border/30 px-3 py-1.5 no-scrollbar">
        <button onClick={() => setActiveCategory("all")}
          className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
            activeCategory === "all" ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-foreground")}>
          All
        </button>
        {categories.map((c) => (
          <button key={c} onClick={() => setActiveCategory(c)}
            className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
              activeCategory === c ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-foreground")}>
            {CAT_LABEL[c]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filtered.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
            className="w-full rounded-xl border border-border/40 bg-card/30 px-3 py-2.5 text-left hover:bg-card/50 transition-colors"
          >
            <div className="flex items-start gap-2 mb-1">
              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold", CAT_COLOR[entry.category])}>
                {CAT_LABEL[entry.category]}
              </span>
              <p className="font-medium text-foreground leading-tight flex-1">{entry.title}</p>
              {entry.autoSynced && <CheckCircle className="size-3 shrink-0 text-emerald-400/60 mt-0.5" />}
            </div>

            {expanded === entry.id ? (
              <div className="mt-2 space-y-2 text-left">
                <p className="text-muted-foreground/80 leading-relaxed">{entry.summary}</p>
                {entry.sourceFile && (
                  <div className="flex items-center gap-1.5 text-[10px] text-sky-400/70">
                    <FileCode className="size-3 shrink-0" />
                    <span className="font-mono">{entry.sourceFile}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground/40">
                  <div className="flex gap-1">
                    {entry.tags.map((t) => (
                      <span key={t} className="rounded bg-muted/20 px-1.5 py-0.5 font-mono">{t}</span>
                    ))}
                  </div>
                  <span className="flex items-center gap-1"><Clock className="size-2.5" />{entry.lastUpdated}</span>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground/60 line-clamp-2 mt-0.5">{entry.summary}</p>
            )}
          </button>
        ))}

        {filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground/40">
            <Search className="size-8 opacity-30" />
            <p>No entries match &ldquo;{search}&rdquo;</p>
          </div>
        )}
      </div>

      <div className="border-t border-border/40 bg-card/20 px-4 py-2 flex items-center gap-2">
        <Link className="size-3 text-muted-foreground/40" />
        <span className="text-[10px] text-muted-foreground/40">Auto-synced with every approved merge</span>
      </div>
    </div>
  );
}
