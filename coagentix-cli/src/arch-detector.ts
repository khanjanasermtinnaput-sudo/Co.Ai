// Architecture Understanding Mode: detect project type before generating code

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { globSync } from "glob";
import chalk from "chalk";
import type { KnowledgeGraph } from "./knowledge-graph.js";

export type ArchType =
  | "nextjs-fullstack"
  | "react-spa"
  | "express-api"
  | "fastapi"
  | "django"
  | "microservice"
  | "monorepo"
  | "cli-tool"
  | "library"
  | "mobile-expo"
  | "electron"
  | "saas-platform"
  | "enterprise"
  | "unknown";

export interface ArchReport {
  type: ArchType;
  confidence: number;        // 0–1
  framework: string;
  language: string;
  packageManager: string;
  hasDatabase: boolean;
  hasAuth: boolean;
  hasTests: boolean;
  hasDocker: boolean;
  hasCi: boolean;
  services: string[];        // detected service names
  signals: string[];         // what led to this detection
  recommendation: string;    // how the AI should approach code generation
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
  scripts?: Record<string, string>;
}

function readPackageJson(root: string): PackageJson {
  const p = join(root, "package.json");
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")) as PackageJson; }
  catch { return {}; }
}

function hasDep(pkg: PackageJson, ...names: string[]): boolean {
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  return names.some((n) => n in all);
}

export function detectArchitecture(root: string, graph?: KnowledgeGraph): ArchReport {
  const pkg     = readPackageJson(root);
  const signals: string[] = [];
  let type: ArchType = "unknown";
  let confidence = 0.5;
  let framework = "unknown";
  let language = "javascript";
  const services: string[] = [];

  // ── Language ──────────────────────────────────────────────────────────────────
  if (existsSync(join(root, "tsconfig.json")))             { language = "typescript"; signals.push("tsconfig.json"); }
  if (existsSync(join(root, "pyproject.toml")))            { language = "python"; }
  if (existsSync(join(root, "requirements.txt")))          { language = "python"; }
  if (existsSync(join(root, "go.mod")))                    { language = "go"; }
  if (existsSync(join(root, "Cargo.toml")))                { language = "rust"; }

  // ── Package Manager ────────────────────────────────────────────────────────────
  let packageManager = "npm";
  if (existsSync(join(root, "pnpm-lock.yaml"))) packageManager = "pnpm";
  if (existsSync(join(root, "yarn.lock")))      packageManager = "yarn";
  if (existsSync(join(root, "bun.lockb")))      packageManager = "bun";

  // ── Infrastructure ────────────────────────────────────────────────────────────
  const hasDocker = existsSync(join(root, "Dockerfile")) || existsSync(join(root, "docker-compose.yml"));
  const hasCi     = existsSync(join(root, ".github/workflows")) || existsSync(join(root, ".gitlab-ci.yml")) || existsSync(join(root, "Jenkinsfile"));
  const hasTests  = hasDep(pkg, "jest", "vitest", "mocha", "cypress", "playwright") ||
                    existsSync(join(root, "jest.config.js")) || existsSync(join(root, "vitest.config.ts"));
  const hasDatabase = hasDep(pkg, "prisma", "@prisma/client", "drizzle-orm", "typeorm", "mongoose", "pg", "mysql2", "supabase") ||
                      existsSync(join(root, "prisma/schema.prisma")) ||
                      existsSync(join(root, "drizzle.config.ts"));
  const hasAuth   = hasDep(pkg, "next-auth", "@auth/core", "passport", "jsonwebtoken", "clerk", "supabase");

  if (hasDocker)   signals.push("Docker");
  if (hasCi)       signals.push("CI/CD");
  if (hasDatabase) signals.push("Database");
  if (hasAuth)     signals.push("Auth");

  // ── Framework / Architecture Detection ────────────────────────────────────────

  // Monorepo
  if (pkg.workspaces || existsSync(join(root, "turbo.json")) || existsSync(join(root, "nx.json"))) {
    type = "monorepo";
    confidence = 0.9;
    framework = existsSync(join(root, "turbo.json")) ? "Turborepo" : existsSync(join(root, "nx.json")) ? "Nx" : "Yarn Workspaces";
    signals.push("monorepo config");

    // Detect child services
    const subPkgs = globSync("packages/*/package.json", { cwd: root });
    for (const sp of subPkgs) {
      try {
        const sub = JSON.parse(readFileSync(join(root, sp), "utf8")) as PackageJson;
        if (sub.name) services.push(sub.name);
      } catch { /* ignore */ }
    }
  }

  // Next.js Fullstack / SaaS
  else if (hasDep(pkg, "next")) {
    framework = "Next.js";
    const isAppRouter = existsSync(join(root, "app")) || existsSync(join(root, "src/app"));
    signals.push(`Next.js (${isAppRouter ? "App Router" : "Pages Router"})`);

    if (hasDatabase && hasAuth) {
      type = "saas-platform";
      confidence = 0.85;
      signals.push("SaaS signals: auth + DB");
    } else {
      type = "nextjs-fullstack";
      confidence = 0.9;
    }
  }

  // React SPA
  else if (hasDep(pkg, "react") && !hasDep(pkg, "next", "gatsby")) {
    type = "react-spa";
    confidence = 0.85;
    framework = hasDep(pkg, "vite") ? "React + Vite" : hasDep(pkg, "react-scripts") ? "Create React App" : "React";
    signals.push(framework);
  }

  // Express / Node API
  else if (hasDep(pkg, "express", "fastify", "koa", "hapi")) {
    type = "express-api";
    confidence = 0.85;
    framework = hasDep(pkg, "express") ? "Express" : hasDep(pkg, "fastify") ? "Fastify" : "Koa/Hapi";
    signals.push(framework + " API");
  }

  // Python frameworks
  else if (language === "python") {
    if (existsSync(join(root, "manage.py"))) {
      type = "django"; framework = "Django"; confidence = 0.9; signals.push("manage.py");
    } else {
      type = "fastapi"; framework = "FastAPI/Flask"; confidence = 0.7; signals.push("Python project");
    }
  }

  // CLI tool
  else if (existsSync(join(root, "bin")) || pkg.scripts?.["start"]?.includes("node")) {
    type = "cli-tool";
    confidence = 0.7;
    framework = "Node CLI";
    signals.push("bin/ directory");
  }

  // Library
  else if (pkg.scripts?.["build"] && !hasDep(pkg, "react", "vue", "svelte")) {
    type = "library";
    confidence = 0.65;
    framework = "Node Library";
    signals.push("library pattern");
  }

  // Graph-based upgrades
  if (graph) {
    const apiCount = graph.apiRoutes.length;
    if (apiCount > 20 && (type === "nextjs-fullstack" || type === "saas-platform")) {
      type = "enterprise";
      confidence = Math.min(confidence + 0.1, 0.95);
      signals.push(`${apiCount} API routes (enterprise scale)`);
    }
  }

  // ── Recommendation ────────────────────────────────────────────────────────────
  const recMap: Record<ArchType, string> = {
    "nextjs-fullstack":  "Use App Router patterns, Server Components where possible, keep data fetching server-side",
    "react-spa":         "Keep state local, use React Query/SWR for server state, avoid prop drilling",
    "express-api":       "Follow REST conventions, validate with Zod, centralize error handling",
    "fastapi":           "Use Pydantic models for all I/O, async endpoints, dependency injection",
    "django":            "Use class-based views, DRF serializers, keep business logic in models/services",
    "microservice":      "Each service owns its data, communicate via events/HTTP, design for failure",
    "monorepo":          "Keep packages independently deployable, share types via a @types package",
    "cli-tool":          "Single responsibility per command, stream output for long tasks, exit codes matter",
    "library":           "Zero side effects at import time, minimal peer deps, export both ESM and CJS",
    "mobile-expo":       "Optimize for offline-first, use Expo SDK APIs, test on both iOS and Android",
    "electron":          "Separate main/renderer processes, use IPC for communication, minimize renderer privileges",
    "saas-platform":     "Tenant isolation is critical, audit every privilege escalation, rate-limit all APIs",
    "enterprise":        "RBAC on all resources, full audit trail, zero-downtime migrations, document every API",
    "unknown":           "Read the existing patterns carefully before generating — no assumptions",
  };

  return {
    type,
    confidence,
    framework,
    language,
    packageManager,
    hasDatabase,
    hasAuth,
    hasTests,
    hasDocker,
    hasCi,
    services,
    signals,
    recommendation: recMap[type],
  };
}

export function printArchReport(report: ArchReport): void {
  const conf = report.confidence >= 0.85 ? chalk.green : report.confidence >= 0.65 ? chalk.yellow : chalk.dim;

  console.log(chalk.bold("\n  Architecture Report"));
  console.log(chalk.dim("─".repeat(55)));
  console.log(`  Type:       ${chalk.bold(report.type)}  ${conf(`(${Math.round(report.confidence * 100)}% confidence)`)}`);
  console.log(`  Framework:  ${chalk.bold(report.framework)}`);
  console.log(`  Language:   ${chalk.bold(report.language)}`);
  console.log(`  Pkg Mgr:    ${chalk.dim(report.packageManager)}`);

  const flags = [
    report.hasDatabase ? chalk.green("DB") : chalk.dim("no-DB"),
    report.hasAuth     ? chalk.green("Auth") : chalk.dim("no-Auth"),
    report.hasTests    ? chalk.green("Tests") : chalk.yellow("no-Tests"),
    report.hasDocker   ? chalk.green("Docker") : chalk.dim("no-Docker"),
    report.hasCi       ? chalk.green("CI") : chalk.dim("no-CI"),
  ];
  console.log(`  Features:   ${flags.join("  ")}`);

  if (report.signals.length > 0) {
    console.log(`  Signals:    ${chalk.dim(report.signals.join(", "))}`);
  }
  if (report.services.length > 0) {
    console.log(`  Services:   ${chalk.cyan(report.services.join(", "))}`);
  }

  console.log(chalk.dim("\n  → " + report.recommendation));
  console.log();
}
