"use client";

// Phase 86 — AI Marketplace
// Sandboxed extensions: AI agents, prompt packs, UI components, providers, connectors.
// Every extension runs in a secure sandbox. Explicit permission required for sensitive data.

import { useState } from "react";
import { Store, Download, Star, Shield, CheckCircle, Lock, Search, Zap, Package2, Globe, TestTube, Database, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ExtCategory = "ai-agent" | "prompt-pack" | "ui-component" | "deployment" | "cloud" | "testing" | "database" | "design" | "security" | "language-pack";

interface Extension {
  id: string;
  name: string;
  author: string;
  category: ExtCategory;
  description: string;
  rating: number;
  downloads: number;
  version: string;
  verified: boolean;
  installed: boolean;
  permissions: string[];
  sandboxed: boolean;
}

const CAT_CONFIG: Record<ExtCategory, { label: string; icon: React.ElementType; color: string }> = {
  "ai-agent":     { label: "AI Agents",     icon: Zap,      color: "text-primary bg-primary/10"       },
  "prompt-pack":  { label: "Prompt Packs",  icon: Zap,      color: "text-purple-400 bg-purple-500/10" },
  "ui-component": { label: "UI Components", icon: Palette,  color: "text-pink-400 bg-pink-500/10"     },
  deployment:     { label: "Deployment",    icon: Globe,    color: "text-blue-400 bg-blue-500/10"     },
  cloud:          { label: "Cloud",         icon: Globe,    color: "text-sky-400 bg-sky-500/10"       },
  testing:        { label: "Testing",       icon: TestTube, color: "text-yellow-400 bg-yellow-500/10" },
  database:       { label: "Database",      icon: Database, color: "text-emerald-400 bg-emerald-500/10"},
  design:         { label: "Design Systems",icon: Palette,  color: "text-rose-400 bg-rose-500/10"     },
  security:       { label: "Security",      icon: Shield,   color: "text-red-400 bg-red-500/10"       },
  "language-pack":{ label: "Language Packs",icon: Globe,    color: "text-muted-foreground bg-muted/20"},
};

const EXTENSIONS: Extension[] = [
  {
    id: "1", name: "Claude Agent Pro", author: "Anthropic",
    category: "ai-agent", description: "Enhanced Claude AI agent with extended context, multi-step reasoning, and code execution.",
    rating: 4.9, downloads: 48200, version: "2.1.0", verified: true, installed: true,
    permissions: ["read:files", "write:diff"], sandboxed: true,
  },
  {
    id: "2", name: "Vercel Deploy Pro", author: "Vercel Inc.",
    category: "deployment", description: "One-click deployment to Vercel with preview URLs, rollback, and analytics.",
    rating: 4.8, downloads: 32100, version: "1.5.2", verified: true, installed: false,
    permissions: ["read:env", "network:vercel.com"], sandboxed: true,
  },
  {
    id: "3", name: "Playwright AI Tests", author: "Microsoft",
    category: "testing", description: "AI-generated Playwright E2E tests from component screenshots and user flows.",
    rating: 4.7, downloads: 18900, version: "1.2.0", verified: true, installed: false,
    permissions: ["read:files", "run:tests"], sandboxed: true,
  },
  {
    id: "4", name: "shadcn/ui Extended", author: "shadcn",
    category: "ui-component", description: "50+ additional shadcn components: data tables, charts, kanban, calendar, etc.",
    rating: 4.9, downloads: 61400, version: "0.8.1", verified: true, installed: false,
    permissions: ["write:files"], sandboxed: true,
  },
  {
    id: "5", name: "Security Scanner Pro", author: "Snyk",
    category: "security", description: "Real-time vulnerability detection, CVE database, dependency audit, OWASP checks.",
    rating: 4.6, downloads: 22700, version: "3.0.4", verified: true, installed: true,
    permissions: ["read:files", "read:deps", "network:api.snyk.io"], sandboxed: true,
  },
  {
    id: "6", name: "PlanetScale Connector", author: "PlanetScale",
    category: "database", description: "Visual schema browser, query runner, and migration manager for PlanetScale.",
    rating: 4.5, downloads: 9800, version: "1.1.0", verified: true, installed: false,
    permissions: ["network:planetscale.com", "read:env:DATABASE_URL"], sandboxed: true,
  },
  {
    id: "7", name: "AWS Infra Generator", author: "Amazon",
    category: "cloud", description: "AI generates CloudFormation / CDK templates from your architecture description.",
    rating: 4.4, downloads: 14200, version: "0.9.0", verified: false, installed: false,
    permissions: ["network:aws.amazon.com", "read:env:AWS_*"], sandboxed: true,
  },
  {
    id: "8", name: "Thai Language Pack", author: "CoCode Community",
    category: "language-pack", description: "Thai UI localization, Thai code comments support, and Thai-English AI mode.",
    rating: 4.8, downloads: 3200, version: "1.0.0", verified: true, installed: false,
    permissions: [], sandboxed: true,
  },
];

interface MarketplacePanelProps { className?: string }

export function MarketplacePanel({ className }: MarketplacePanelProps) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<ExtCategory | "all" | "installed">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [extensions, setExtensions] = useState(EXTENSIONS);

  async function handleInstall(id: string) {
    setInstalling(id);
    await new Promise((r) => setTimeout(r, 1600));
    setExtensions((prev) => prev.map((e) => e.id === id ? { ...e, installed: true } : e));
    setInstalling(null);
  }

  const filtered = extensions.filter((e) => {
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.description.toLowerCase().includes(search.toLowerCase());
    const matchCat = activeCategory === "all" ? true : activeCategory === "installed" ? e.installed : e.category === activeCategory;
    return matchSearch && matchCat;
  });

  const selectedExt = extensions.find((e) => e.id === selected);
  const installedCount = extensions.filter((e) => e.installed).length;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden text-[12px]", className)}>
      <div className="flex items-center justify-between border-b border-border/50 bg-card/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Store className="size-4 text-primary" />
          <span className="font-semibold text-foreground">AI Marketplace</span>
        </div>
        <span className="text-[10px] text-muted-foreground/50">{installedCount} installed</span>
      </div>

      <div className="border-b border-border/30 px-3 py-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/40" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search extensions…"
            className="w-full rounded-lg border border-border/40 bg-white/[0.02] py-1.5 pl-7 pr-3 text-[11px] outline-none focus:border-primary/30 placeholder:text-muted-foreground/30" />
        </div>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-border/30 px-3 py-1.5 no-scrollbar">
        {(["all", "installed", ...Object.keys(CAT_CONFIG)] as const).map((cat) => (
          <button key={cat} type="button" onClick={() => setActiveCategory(cat as typeof activeCategory)}
            className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize transition-colors",
              activeCategory === cat ? "bg-primary/20 text-primary" : "text-muted-foreground/60 hover:text-foreground")}>
            {cat === "all" ? "All" : cat === "installed" ? `Installed (${installedCount})` : CAT_CONFIG[cat as ExtCategory]?.label ?? cat}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className={cn("overflow-y-auto p-3 space-y-2", selected ? "w-48 shrink-0 border-r border-border/40" : "flex-1")}>
          {filtered.map((ext) => {
            const cfg = CAT_CONFIG[ext.category];
            const Icon = cfg?.icon ?? Package2;
            return (
              <button key={ext.id} type="button" onClick={() => setSelected(selected === ext.id ? null : ext.id)}
                className={cn("w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                  selected === ext.id ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card/30 hover:bg-card/50")}>
                <div className="flex items-start gap-2">
                  <div className={cn("rounded-md p-1.5 shrink-0", cfg?.color ?? "bg-muted/20")}>
                    <Icon className="size-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <p className="font-medium text-foreground truncate">{ext.name}</p>
                      {ext.verified && <Shield className="size-2.5 text-emerald-400 shrink-0" />}
                      {ext.installed && <CheckCircle className="size-2.5 text-primary shrink-0" />}
                    </div>
                    <p className="text-[9px] text-muted-foreground/50">{ext.author}</p>
                    {!selected && <p className="text-[10px] text-muted-foreground/60 line-clamp-1 mt-0.5">{ext.description}</p>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {selected && selectedExt && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div>
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="font-semibold text-foreground">{selectedExt.name}</p>
                {selectedExt.verified && (
                  <span className="flex items-center gap-1 text-[9px] text-emerald-400 bg-emerald-500/10 rounded-full px-1.5 py-0.5">
                    <Shield className="size-2.5" /> Verified
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground/60">{selectedExt.author} · v{selectedExt.version}</p>
              <div className="flex items-center gap-2 mt-1 text-[10px]">
                <div className="flex items-center gap-0.5 text-amber-400">
                  <Star className="size-2.5 fill-amber-400" />{selectedExt.rating}
                </div>
                <span className="text-muted-foreground/50">{(selectedExt.downloads / 1000).toFixed(1)}k installs</span>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground/80 leading-relaxed">{selectedExt.description}</p>

            <div className="rounded-xl border border-border/40 bg-card/30 px-3 py-2.5">
              <p className="font-medium text-muted-foreground/80 mb-2 flex items-center gap-1.5 text-[11px]">
                <Lock className="size-3.5" /> Sandbox Permissions
              </p>
              {selectedExt.permissions.length === 0 ? (
                <p className="text-[10px] text-emerald-400/70">No sensitive permissions required</p>
              ) : (
                <div className="space-y-1">
                  {selectedExt.permissions.map((p) => (
                    <div key={p} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                      <CheckCircle className="size-2.5 text-primary/50 shrink-0" />
                      <span className="font-mono">{p}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[9px] text-muted-foreground/40">Runs in isolated sandbox — no access to other extensions or secrets without explicit grant</p>
            </div>

            {selectedExt.installed ? (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                <CheckCircle className="size-4 text-emerald-400" />
                <span className="text-[11px] text-emerald-400">Installed and active</span>
              </div>
            ) : (
              <Button className="w-full h-9 gap-2" onClick={() => handleInstall(selectedExt.id)} disabled={installing === selectedExt.id}>
                {installing === selectedExt.id ? <><Zap className="size-3.5 animate-pulse" /> Installing…</> : <><Download className="size-3.5" /> Install Extension</>}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
