// Adaptive panel system — determines which panels are relevant to the current file context.

export interface PanelDef {
  id: string;
  label: string;
  description: string;
  shortcut?: string;
  /** Hidden unless Developer Mode is ON */
  devModeOnly?: boolean;
}

export const PANEL_DEFS: Record<string, PanelDef> = {
  diff:          { id: "diff",         label: "Diff",          description: "Review and accept AI-generated code changes" },
  preview:       { id: "preview",      label: "Preview",       description: "Live browser preview of your app" },
  "multi-preview":{ id:"multi-preview",label: "Devices",       description: "Preview across mobile, tablet, and desktop" },
  github:        { id: "github",       label: "GitHub",        description: "Commit, branch, and pull requests", shortcut: "Ctrl+Shift+G" },
  checkpoints:   { id: "checkpoints",  label: "History",       description: "Checkpoint history — undo/redo snapshots" },
  explorer:      { id: "explorer",     label: "Refactor",      description: "AI-powered rename, extract, and refactoring tools" },
  tests:         { id: "tests",        label: "Tests",         description: "Run and manage your test suite" },
  design:        { id: "design",       label: "Design",        description: "Inspect colors, spacing, typography, and layout" },
  deps:          { id: "deps",         label: "Deps",          description: "View and manage npm/package dependencies" },
  docs:          { id: "docs",         label: "Docs",          description: "AI-generated documentation for your code" },
  diagnostics:   { id: "diagnostics",  label: "Issues",        description: "TypeScript errors, lint warnings, and type checks" },
  pair:          { id: "pair",         label: "Pair AI",       description: "AI pair programmer — real-time suggestions" },
  deploy:        { id: "deploy",       label: "Deploy",        description: "Deploy to Vercel, Railway, or Render",          shortcut: "Ctrl+Shift+D" },
  env:           { id: "env",          label: "Env",           description: "Manage environment variables securely" },
  perf:          { id: "perf",         label: "Perf",          description: "Bundle size and runtime performance analysis" },
  security:      { id: "security",     label: "Security",      description: "Dependency and code vulnerability scanning" },
  api:           { id: "api",          label: "API Studio",    description: "Test and document REST/GraphQL endpoints" },
  db:            { id: "db",           label: "Database",      description: "Supabase / PostgreSQL schema and query explorer" },
  mobile:        { id: "mobile",       label: "Mobile",        description: "iOS and Android device preview" },
  review:        { id: "review",       label: "AI Review",     description: "AI code review with actionable suggestions" },
  // Developer Mode only
  graph:         { id: "graph",        label: "Graph",         description: "Knowledge graph of code relationships",          devModeOnly: true },
  cicd:          { id: "cicd",         label: "CI/CD",         description: "GitHub Actions workflow builder",               devModeOnly: true },
  collab:        { id: "collab",       label: "Collab",        description: "Real-time team collaboration",                  devModeOnly: true },
  testgen:       { id: "testgen",      label: "Test Gen",      description: "AI-generated test cases from source code",      devModeOnly: true },
  search:        { id: "search",       label: "Semantic Search",description: "AI-powered semantic code search",             devModeOnly: true },
  translate:     { id: "translate",    label: "Translate",     description: "Convert code between languages",                devModeOnly: true },
  changelog:     { id: "changelog",    label: "Changelog",     description: "Auto-generated changelog from commit history",  devModeOnly: true },
  arch:          { id: "arch",         label: "Architecture",  description: "System architecture and dependency diagram",    devModeOnly: true },
  runtime:       { id: "runtime",      label: "Runtime",       description: "Live runtime metrics and execution timeline",   devModeOnly: true },
  a11y:          { id: "a11y",         label: "Accessibility", description: "WCAG accessibility audit and fixes",            devModeOnly: true },
  i18n:          { id: "i18n",         label: "i18n",          description: "Internationalization string management",        devModeOnly: true },
  coverage:      { id: "coverage",     label: "Coverage",      description: "Code coverage visualization per file",          devModeOnly: true },
  scaffold:      { id: "scaffold",     label: "Scaffold",      description: "Generate components, routes, and modules",      devModeOnly: true },
  // Phase 71–80 (Developer Mode only by default)
  "cloud-workspace":    { id: "cloud-workspace",   label: "Cloud Workspace",   description: "Sync and restore workspace across devices",          devModeOnly: false },
  "realtime-collab":    { id: "realtime-collab",   label: "Live Collab",       description: "Real-time multi-developer collaboration with cursors", devModeOnly: false },
  "project-manager":    { id: "project-manager",   label: "PM",                description: "AI Project Manager — backlog, milestones, sprints",   devModeOnly: false },
  "analytics":          { id: "analytics",          label: "Analytics",         description: "Engineering metrics: cycle time, churn, debt trends",  devModeOnly: true  },
  "devops":             { id: "devops",             label: "DevOps AI",         description: "AI-managed CI/CD, Docker, Kubernetes, and secrets",    devModeOnly: true  },
  "infrastructure":     { id: "infrastructure",     label: "Infra",             description: "Cloud infrastructure graph: AWS, GCP, Vercel, Railway", devModeOnly: true  },
  "incident-response":  { id: "incident-response",  label: "Incidents",         description: "Auto collect logs → root cause → generate hotfix",     devModeOnly: true  },
  "business-intel":     { id: "business-intel",     label: "Biz Intel",         description: "Feature usage, conversion impact, revenue analysis",    devModeOnly: true  },
  "governance":         { id: "governance",         label: "Governance",        description: "RBAC, audit logs, compliance, SSO, branch policies",    devModeOnly: true  },
  "autonomous-engine":  { id: "autonomous-engine",  label: "Autonomous",        description: "Full AI software engineering loop with human approval",  devModeOnly: true  },
  // Phase 81–90
  "self-improving":     { id: "self-improving",     label: "Self-Improve",      description: "AI learns from every task — stores validated patterns",      devModeOnly: true  },
  "knowledge-base":     { id: "knowledge-base",     label: "Knowledge",         description: "Living engineering knowledge base linked to source files",    devModeOnly: false },
  "arch-evolution":     { id: "arch-evolution",     label: "Arch Roadmap",      description: "6 & 12-month architecture roadmap, scaling & debt forecast",  devModeOnly: true  },
  "auto-refactor":      { id: "auto-refactor",      label: "Refactor AI",       description: "Continuous codebase audit — proposals with risk & diff",      devModeOnly: true  },
  "docs-platform":      { id: "docs-platform",      label: "Living Docs",       description: "Docs synced with every approved change — never outdated",     devModeOnly: false },
  "marketplace":        { id: "marketplace",        label: "Marketplace",       description: "Sandboxed AI agent extensions, prompt packs, connectors",     devModeOnly: false },
  "cross-project":      { id: "cross-project",      label: "Cross-Project",     description: "Impact analysis across frontend, backend, SDK, mobile, infra", devModeOnly: true  },
  "simulation":         { id: "simulation",         label: "Simulate",          description: "Pre-implementation simulation — perf, scale, cost, failure",  devModeOnly: true  },
  "global-intel":       { id: "global-intel",       label: "Global Intel",      description: "Aggregate engineering trends across all repositories",        devModeOnly: true  },
  "engineering-os":     { id: "engineering-os",     label: "Eng OS",            description: "Core services: orchestrator, agents, runtime, model router",  devModeOnly: true  },
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
  style:     ["preview",  "design",      "mobile",   "multi-preview"],
  api:       ["api",      "db",          "env",      "perf"],
  test:      ["tests",    "diagnostics", "coverage", "testgen"],
  component: ["preview",  "design",      "tests",    "docs"],
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
