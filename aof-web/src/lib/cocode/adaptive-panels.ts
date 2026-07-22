// Adaptive panel system — determines which panels are relevant to the current file context.

import type { LucideIcon } from "lucide-react";
import {
  SplitSquareHorizontal, Eye, Laptop, Github, History, Wrench,
  FlaskConical, Package2, BookOpen, AlertCircle, Bot,
  Rocket, KeyRound, Gauge, ShieldCheck, Globe, Database, Smartphone,
  Star, Network, GitMerge, Users, Search, Languages, ScrollText,
  Activity, Accessibility, BarChart3, Wand2,
} from "lucide-react";

export interface PanelDef {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  shortcut?: string;
  /** Hidden unless Developer Mode is ON */
  devModeOnly?: boolean;
  /** Task-oriented workspace this panel belongs to (drives grouped navigation). */
  group: PanelGroup;
}

// Four intent-oriented workspaces the 32 panels are organized into — Build
// (make it), Understand (see/explain it), Verify (prove it's right), Ship
// (get it out safely). Order here is the order groups render in the command
// palette, the collapsed rail, and the "More" panel menu. Replaces the prior
// eight tool-shaped groups (Code/Preview/Quality/Source Control/Data & Deps/
// Ship/Docs & Architecture/Collaborate) — CORE and the file-context adaptivity
// below are unchanged; only navigation grouping moved.
export type PanelGroup = "Build" | "Understand" | "Verify" | "Ship";

export const PANEL_GROUP_ORDER: PanelGroup[] = ["Build", "Understand", "Verify", "Ship"];

export const PANEL_DEFS: Record<string, PanelDef> = {
  // ── Build — making and changing code ─────────────────────────────────────
  explorer:      { id: "explorer",     label: "Refactor",      icon: Wrench,                group: "Build",       description: "AI-powered rename, extract, and refactoring tools" },
  diff:          { id: "diff",         label: "Diff",          icon: SplitSquareHorizontal, group: "Build",       description: "Review and accept AI-generated code changes" },
  translate:     { id: "translate",    label: "Translate",     icon: Languages,             group: "Build",       description: "Convert code between languages",                devModeOnly: true },
  scaffold:      { id: "scaffold",     label: "Scaffold",      icon: Wand2,                 group: "Build",       description: "Generate components, routes, and modules",      devModeOnly: true },
  checkpoints:   { id: "checkpoints",  label: "History",       icon: History,               group: "Build",       description: "Checkpoint history — undo/redo snapshots" },
  i18n:          { id: "i18n",         label: "i18n",          icon: Globe,                 group: "Build",       description: "Internationalization string management",        devModeOnly: true },
  pair:          { id: "pair",         label: "Pair AI",       icon: Bot,                   group: "Build",       description: "AI pair programmer — real-time suggestions" },
  collab:        { id: "collab",       label: "Collab",        icon: Users,                 group: "Build",       description: "Real-time team collaboration",                  devModeOnly: true },
  // ── Understand — seeing and explaining the project ──────────────────────
  search:        { id: "search",       label: "Semantic Search",icon: Search,               group: "Understand",  description: "AI-powered semantic code search",             devModeOnly: true },
  preview:       { id: "preview",      label: "Preview",       icon: Eye,                   group: "Understand",  description: "Live browser preview of your app" },
  "multi-preview":{ id:"multi-preview",label: "Devices",       icon: Laptop,                group: "Understand",  description: "Preview across mobile, tablet, and desktop" },
  mobile:        { id: "mobile",       label: "Mobile",        icon: Smartphone,            group: "Understand",  description: "iOS and Android device preview" },
  api:           { id: "api",          label: "API Studio",    icon: Globe,                 group: "Understand",  description: "Test and document REST/GraphQL endpoints" },
  db:            { id: "db",           label: "Database",      icon: Database,              group: "Understand",  description: "Supabase / PostgreSQL schema and query explorer" },
  docs:          { id: "docs",         label: "Docs",          icon: BookOpen,              group: "Understand",  description: "AI-generated documentation for your code" },
  arch:          { id: "arch",         label: "Architecture",  icon: Network,               group: "Understand",  description: "System architecture and dependency diagram",    devModeOnly: true },
  graph:         { id: "graph",        label: "Graph",         icon: Network,               group: "Understand",  description: "Knowledge graph of code relationships",          devModeOnly: true },
  // ── Verify — proving the code is right ───────────────────────────────────
  diagnostics:   { id: "diagnostics",  label: "Issues",        icon: AlertCircle,           group: "Verify",      description: "TypeScript errors, lint warnings, and type checks" },
  tests:         { id: "tests",        label: "Tests",         icon: FlaskConical,          group: "Verify",      description: "Run and manage your test suite" },
  testgen:       { id: "testgen",      label: "Test Gen",      icon: FlaskConical,          group: "Verify",      description: "AI-generated test cases from source code",      devModeOnly: true },
  coverage:      { id: "coverage",     label: "Coverage",      icon: BarChart3,             group: "Verify",      description: "Code coverage visualization per file",          devModeOnly: true },
  review:        { id: "review",       label: "AI Review",     icon: Star,                  group: "Verify",      description: "AI code review with actionable suggestions" },
  a11y:          { id: "a11y",         label: "Accessibility", icon: Accessibility,         group: "Verify",      description: "WCAG accessibility audit and fixes",            devModeOnly: true },
  perf:          { id: "perf",         label: "Perf",          icon: Gauge,                 group: "Verify",      description: "Bundle size and runtime performance analysis" },
  security:      { id: "security",     label: "Security",      icon: ShieldCheck,           group: "Verify",      description: "Dependency and code vulnerability scanning" },
  // ── Ship — getting it out safely ─────────────────────────────────────────
  github:        { id: "github",       label: "GitHub",        icon: Github,                group: "Ship",        description: "Commit, branch, and pull requests", shortcut: "Ctrl+Shift+G" },
  changelog:     { id: "changelog",    label: "Changelog",     icon: ScrollText,            group: "Ship",        description: "Auto-generated changelog from commit history",  devModeOnly: true },
  env:           { id: "env",          label: "Env",           icon: KeyRound,              group: "Ship",        description: "Manage environment variables securely" },
  deps:          { id: "deps",         label: "Deps",          icon: Package2,              group: "Ship",        description: "View and manage npm/package dependencies" },
  deploy:        { id: "deploy",       label: "Deploy",        icon: Rocket,                group: "Ship",        description: "Deploy to Vercel, Railway, or Render",          shortcut: "Ctrl+Shift+D" },
  cicd:          { id: "cicd",         label: "CI/CD",         icon: GitMerge,              group: "Ship",        description: "GitHub Actions workflow builder",               devModeOnly: true },
  runtime:       { id: "runtime",      label: "Runtime",       icon: Activity,              group: "Ship",        description: "Live runtime metrics and execution timeline",   devModeOnly: true },
};

export type FileContext = "style" | "api" | "test" | "component" | "config" | "markdown" | "default";

export function detectFileContext(filePath: string | null): FileContext {
  if (!filePath) return "default";
  const p = filePath.toLowerCase();
  if (p.endsWith(".css") || p.endsWith(".scss") || p.endsWith(".sass") || p.endsWith(".less")) return "style";
  if (p.includes(".test.") || p.includes(".spec.") || p.includes("__tests__") || p.includes("/tests/")) return "test";
  if (p.includes("/api/") || p.endsWith(".route.ts") || p.endsWith(".route.tsx") || p.includes("server.ts")) return "api";
  if (p.endsWith(".md") || p.endsWith(".mdx")) return "markdown";
  if (p.endsWith(".json") || p.endsWith(".yaml") || p.endsWith(".yml") || p.endsWith(".toml")) return "config";
  if (p.endsWith(".tsx") || p.endsWith(".jsx")) return "component";
  return "default";
}

// Panels always present regardless of context
const CORE: string[] = ["diff", "github", "deploy"];

const CONTEXT_PANELS: Record<FileContext, string[]> = {
  style:     ["preview",  "mobile",      "multi-preview"],
  api:       ["api",      "db",          "env",      "perf"],
  test:      ["tests",    "diagnostics", "coverage", "testgen"],
  component: ["preview",  "tests",       "docs"],
  config:    ["env",      "deps",        "docs",     "diagnostics"],
  markdown:  ["preview",  "docs",        "github"],
  default:   ["preview",  "docs",        "diagnostics"],
};

export function getAdaptivePanels(
  filePath: string | null,
  devMode: boolean,
): { primary: PanelDef[]; overflow: PanelDef[] } {
  const ctx = detectFileContext(filePath);
  const primaryIds = [...new Set([...CORE, ...CONTEXT_PANELS[ctx]])];

  const allIds = Object.keys(PANEL_DEFS);

  const overflow = allIds
    .filter((id) => {
      if (primaryIds.includes(id)) return false;
      const def = PANEL_DEFS[id];
      if (def.devModeOnly && !devMode) return false;
      return true;
    })
    .map((id) => PANEL_DEFS[id]);

  return {
    primary: primaryIds.map((id) => PANEL_DEFS[id]),
    overflow,
  };
}
