// Adaptive panel system — determines which panels are relevant to the current file context.

import type { LucideIcon } from "lucide-react";
import {
  SplitSquareHorizontal, Eye, Laptop, Github, History, Wrench,
  FlaskConical, Package2, BookOpen, AlertCircle, Bot,
  Rocket, KeyRound, Gauge, ShieldCheck, Globe, Database, Smartphone,
  Star, Network, GitMerge, Users, Search, Languages, ScrollText,
  Activity, Accessibility, BarChart3, Wand2,
  Cloud, MousePointer2, KanbanSquare, LineChart, Boxes, Server,
  Siren, PieChart, Landmark, Cpu, Brain, Library, Route, RefreshCw,
  Files, Store, GitFork, Beaker, Radar, Cog, Building2, ClipboardList,
  PenTool, Gavel, ClipboardCheck, TrendingUp, Lightbulb, Grid3x3,
  Share2, Telescope,
} from "lucide-react";

export interface PanelDef {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  shortcut?: string;
  /** Hidden unless Developer Mode is ON */
  devModeOnly?: boolean;
}

export const PANEL_DEFS: Record<string, PanelDef> = {
  diff:          { id: "diff",         label: "Diff",          icon: SplitSquareHorizontal, description: "Review and accept AI-generated code changes" },
  preview:       { id: "preview",      label: "Preview",       icon: Eye,                   description: "Live browser preview of your app" },
  "multi-preview":{ id:"multi-preview",label: "Devices",       icon: Laptop,                description: "Preview across mobile, tablet, and desktop" },
  github:        { id: "github",       label: "GitHub",        icon: Github,                description: "Commit, branch, and pull requests", shortcut: "Ctrl+Shift+G" },
  checkpoints:   { id: "checkpoints",  label: "History",       icon: History,               description: "Checkpoint history — undo/redo snapshots" },
  explorer:      { id: "explorer",     label: "Refactor",      icon: Wrench,                description: "AI-powered rename, extract, and refactoring tools" },
  tests:         { id: "tests",        label: "Tests",         icon: FlaskConical,          description: "Run and manage your test suite" },
  deps:          { id: "deps",         label: "Deps",          icon: Package2,              description: "View and manage npm/package dependencies" },
  docs:          { id: "docs",         label: "Docs",          icon: BookOpen,              description: "AI-generated documentation for your code" },
  diagnostics:   { id: "diagnostics",  label: "Issues",        icon: AlertCircle,           description: "TypeScript errors, lint warnings, and type checks" },
  pair:          { id: "pair",         label: "Pair AI",       icon: Bot,                   description: "AI pair programmer — real-time suggestions" },
  deploy:        { id: "deploy",       label: "Deploy",        icon: Rocket,                description: "Deploy to Vercel, Railway, or Render",          shortcut: "Ctrl+Shift+D" },
  env:           { id: "env",          label: "Env",           icon: KeyRound,              description: "Manage environment variables securely" },
  perf:          { id: "perf",         label: "Perf",          icon: Gauge,                 description: "Bundle size and runtime performance analysis" },
  security:      { id: "security",     label: "Security",      icon: ShieldCheck,           description: "Dependency and code vulnerability scanning" },
  api:           { id: "api",          label: "API Studio",    icon: Globe,                 description: "Test and document REST/GraphQL endpoints" },
  db:            { id: "db",           label: "Database",      icon: Database,              description: "Supabase / PostgreSQL schema and query explorer" },
  mobile:        { id: "mobile",       label: "Mobile",        icon: Smartphone,            description: "iOS and Android device preview" },
  review:        { id: "review",       label: "AI Review",     icon: Star,                  description: "AI code review with actionable suggestions" },
  // Developer Mode only
  graph:         { id: "graph",        label: "Graph",         icon: Network,               description: "Knowledge graph of code relationships",          devModeOnly: true },
  cicd:          { id: "cicd",         label: "CI/CD",         icon: GitMerge,              description: "GitHub Actions workflow builder",               devModeOnly: true },
  collab:        { id: "collab",       label: "Collab",        icon: Users,                 description: "Real-time team collaboration",                  devModeOnly: true },
  testgen:       { id: "testgen",      label: "Test Gen",      icon: FlaskConical,          description: "AI-generated test cases from source code",      devModeOnly: true },
  search:        { id: "search",       label: "Semantic Search",icon: Search,               description: "AI-powered semantic code search",             devModeOnly: true },
  translate:     { id: "translate",    label: "Translate",     icon: Languages,             description: "Convert code between languages",                devModeOnly: true },
  changelog:     { id: "changelog",    label: "Changelog",     icon: ScrollText,            description: "Auto-generated changelog from commit history",  devModeOnly: true },
  arch:          { id: "arch",         label: "Architecture",  icon: Network,               description: "System architecture and dependency diagram",    devModeOnly: true },
  runtime:       { id: "runtime",      label: "Runtime",       icon: Activity,              description: "Live runtime metrics and execution timeline",   devModeOnly: true },
  a11y:          { id: "a11y",         label: "Accessibility", icon: Accessibility,         description: "WCAG accessibility audit and fixes",            devModeOnly: true },
  i18n:          { id: "i18n",         label: "i18n",          icon: Globe,                 description: "Internationalization string management",        devModeOnly: true },
  coverage:      { id: "coverage",     label: "Coverage",      icon: BarChart3,             description: "Code coverage visualization per file",          devModeOnly: true },
  scaffold:      { id: "scaffold",     label: "Scaffold",      icon: Wand2,                 description: "Generate components, routes, and modules",      devModeOnly: true },
  // Phase 71–80 (Developer Mode only by default)
  "cloud-workspace":    { id: "cloud-workspace",   label: "Cloud Workspace",   icon: Cloud,          description: "Sync and restore workspace across devices",          devModeOnly: false },
  "realtime-collab":    { id: "realtime-collab",   label: "Live Collab",       icon: MousePointer2,  description: "Real-time multi-developer collaboration with cursors", devModeOnly: false },
  "project-manager":    { id: "project-manager",   label: "PM",                icon: KanbanSquare,   description: "AI Project Manager — backlog, milestones, sprints",   devModeOnly: false },
  "analytics":          { id: "analytics",          label: "Analytics",         icon: LineChart,      description: "Engineering metrics: cycle time, churn, debt trends",  devModeOnly: true  },
  "devops":             { id: "devops",             label: "DevOps AI",         icon: Boxes,          description: "AI-managed CI/CD, Docker, Kubernetes, and secrets",    devModeOnly: true  },
  "infrastructure":     { id: "infrastructure",     label: "Infra",             icon: Server,         description: "Cloud infrastructure graph: AWS, GCP, Vercel, Railway", devModeOnly: true  },
  "incident-response":  { id: "incident-response",  label: "Incidents",        icon: Siren,          description: "Auto collect logs → root cause → generate hotfix",     devModeOnly: true  },
  "business-intel":     { id: "business-intel",     label: "Biz Intel",        icon: PieChart,       description: "Feature usage, conversion impact, revenue analysis",    devModeOnly: true  },
  "governance":         { id: "governance",         label: "Governance",       icon: Landmark,       description: "RBAC, audit logs, compliance, SSO, branch policies",    devModeOnly: true  },
  "autonomous-engine":  { id: "autonomous-engine",  label: "Autonomous",       icon: Cpu,            description: "Full AI software engineering loop with human approval",  devModeOnly: true  },
  // Phase 81–90
  "self-improving":     { id: "self-improving",     label: "Self-Improve",     icon: Brain,          description: "AI learns from every task — stores validated patterns",      devModeOnly: true  },
  "knowledge-base":     { id: "knowledge-base",     label: "Knowledge",        icon: Library,        description: "Living engineering knowledge base linked to source files",    devModeOnly: false },
  "arch-evolution":     { id: "arch-evolution",     label: "Arch Roadmap",     icon: Route,          description: "6 & 12-month architecture roadmap, scaling & debt forecast",  devModeOnly: true  },
  "auto-refactor":      { id: "auto-refactor",      label: "Refactor AI",      icon: RefreshCw,      description: "Continuous codebase audit — proposals with risk & diff",      devModeOnly: true  },
  "docs-platform":      { id: "docs-platform",      label: "Living Docs",      icon: Files,          description: "Docs synced with every approved change — never outdated",     devModeOnly: false },
  "marketplace":        { id: "marketplace",        label: "Marketplace",      icon: Store,          description: "Sandboxed AI agent extensions, prompt packs, connectors",     devModeOnly: false },
  "cross-project":      { id: "cross-project",      label: "Cross-Project",    icon: GitFork,        description: "Impact analysis across frontend, backend, SDK, mobile, infra", devModeOnly: true  },
  "simulation":         { id: "simulation",         label: "Simulate",         icon: Beaker,         description: "Pre-implementation simulation — perf, scale, cost, failure",  devModeOnly: true  },
  "global-intel":       { id: "global-intel",       label: "Global Intel",     icon: Radar,          description: "Aggregate engineering trends across all repositories",        devModeOnly: true  },
  "engineering-os":     { id: "engineering-os",     label: "Eng OS",           icon: Cog,            description: "Core services: orchestrator, agents, runtime, model router",  devModeOnly: true  },
  // Phase 91–100
  "autonomous-company": { id: "autonomous-company",  label: "AI Company",      icon: Building2,      description: "AI organization: 11 departments with specialized agents",        devModeOnly: true  },
  "biz-requirements":   { id: "biz-requirements",    label: "Biz Intel",       icon: ClipboardList,  description: "Business requirements, revenue impact, market trends analysis",   devModeOnly: false },
  "product-designer":   { id: "product-designer",    label: "AI Design",       icon: PenTool,        description: "AI-generated user flows, wireframes, and UX analysis",           devModeOnly: false },
  "ai-governance":      { id: "ai-governance",       label: "AI Governance",   icon: Gavel,          description: "Every AI action traced: reasoning, confidence, risk, rollback",   devModeOnly: true  },
  "qa-platform":        { id: "qa-platform",         label: "QA Platform",     icon: ClipboardCheck, description: "Continuous QA across UI, backend, DB, infra, a11y, SEO, API",    devModeOnly: true  },
  "predictive-intel":   { id: "predictive-intel",    label: "Predict",         icon: TrendingUp,     description: "Forecast bottlenecks, storage, costs, security risks in advance", devModeOnly: true  },
  "innovation-engine":  { id: "innovation-engine",   label: "Innovate",        icon: Lightbulb,      description: "Evidence-based innovation suggestions across every engineering domain", devModeOnly: false },
  "universal-platform": { id: "universal-platform",  label: "All Platforms",   icon: Grid3x3,        description: "Support web, mobile, desktop, AI/ML, IoT, games, CLI, embedded", devModeOnly: true  },
  "intel-network":      { id: "intel-network",       label: "Intel Network",   icon: Share2,         description: "Cross-org knowledge sharing, templates, benchmarking, patterns",  devModeOnly: true  },
  "ultimate-vision":    { id: "ultimate-vision",     label: "Vision",          icon: Telescope,      description: "Complete software lifecycle: idea → deployment → continuous learning", devModeOnly: false },
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
