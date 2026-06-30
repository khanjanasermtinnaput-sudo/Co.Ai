// ── Project Analysis Engine (Phase 1) ────────────────────────────────────────
// Analyzes a set of project files and returns a structured project map.
// Called when a repo is loaded or files are uploaded.

import { detectLanguage } from "@/lib/cocode/virtual-fs";

export const runtime = "nodejs";

interface AnalyzeRequest {
  files: Array<{ path: string; content: string }>;
}

interface ProjectMap {
  framework: string;
  runtime: string;
  buildSystem: string;
  packageManager: string;
  language: string;
  typescript: boolean;
  eslint: boolean;
  prettier: boolean;
  directories: string[];
  entryPoints: string[];
  configFiles: string[];
  testFiles: string[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  summary: string;
  fileCount: number;
  lineCount: number;
}

export async function POST(req: Request): Promise<Response> {
  let body: AnalyzeRequest;
  try {
    body = (await req.json()) as AnalyzeRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { files } = body;
  if (!Array.isArray(files) || !files.length) {
    return Response.json({ error: "files array required" }, { status: 400 });
  }

  const map = analyzeProject(files);
  return Response.json(map);
}

function analyzeProject(
  files: Array<{ path: string; content: string }>,
): ProjectMap {
  const paths = files.map((f) => f.path);
  const contentMap = new Map(files.map((f) => [f.path, f.content]));

  // ── package.json ──
  const pkgJson = contentMap.get("package.json") ?? contentMap.get("aof-web/package.json");
  let deps: Record<string, string> = {};
  let devDeps: Record<string, string> = {};
  let scripts: Record<string, string> = {};

  if (pkgJson) {
    try {
      const pkg = JSON.parse(pkgJson) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
      };
      deps = pkg.dependencies ?? {};
      devDeps = pkg.devDependencies ?? {};
      scripts = pkg.scripts ?? {};
    } catch {}
  }

  // ── Framework detection ──
  const framework = detectFramework(deps, paths);
  const runtime = detectRuntime(deps, paths);
  const buildSystem = detectBuildSystem(deps, paths, scripts);
  const packageManager = detectPackageManager(paths);
  const language = detectLanguagePrimary(paths);

  // ── Config files ──
  const configFiles = paths.filter((p) =>
    /\.(config|rc)\.(js|ts|mjs|cjs|json)$/.test(p) ||
    p === ".eslintrc" || p === ".prettierrc" || p === "tsconfig.json",
  );

  // ── Entry points ──
  const entryPoints = paths.filter((p) =>
    p.includes("index.ts") || p.includes("index.tsx") || p.includes("page.tsx") ||
    p.includes("main.ts") || p.includes("app.ts") || p.includes("server.ts") ||
    p === "src/index.ts" || p === "src/main.ts",
  );

  // ── Test files ──
  const testFiles = paths.filter((p) =>
    p.includes(".test.") || p.includes(".spec.") || p.includes("__tests__"),
  );

  // ── Directories ──
  const dirs = [
    ...new Set(paths.map((p) => p.split("/").slice(0, 2).join("/"))),
  ].filter((d) => d.includes("/")).slice(0, 20);

  // ── Stats ──
  const lineCount = files.reduce((sum, f) => sum + f.content.split("\n").length, 0);

  const summary = buildSummary(framework, runtime, language, files.length, lineCount, deps);

  return {
    framework,
    runtime,
    buildSystem,
    packageManager,
    language,
    typescript: paths.some((p) => p.endsWith(".ts") || p.endsWith(".tsx")) || !!configFiles.find((p) => p.includes("tsconfig")),
    eslint: !!configFiles.find((p) => p.includes("eslint")),
    prettier: !!configFiles.find((p) => p.includes("prettier")),
    directories: dirs,
    entryPoints: entryPoints.slice(0, 10),
    configFiles: configFiles.slice(0, 15),
    testFiles: testFiles.slice(0, 20),
    dependencies: deps,
    devDependencies: devDeps,
    scripts,
    summary,
    fileCount: files.length,
    lineCount,
  };
}

function detectFramework(deps: Record<string, string>, paths: string[]): string {
  if (deps.next) return `Next.js ${deps.next}`;
  if (deps.nuxt || deps["@nuxt/core"]) return "Nuxt";
  if (deps.astro) return "Astro";
  if (deps["@sveltejs/kit"]) return "SvelteKit";
  if (deps.remix || deps["@remix-run/react"]) return "Remix";
  if (deps.react) return `React ${deps.react}`;
  if (deps.vue) return `Vue ${deps.vue}`;
  if (deps.express) return `Express ${deps.express}`;
  if (deps.fastify) return `Fastify ${deps.fastify}`;
  if (deps["@nestjs/core"]) return "NestJS";
  if (paths.some((p) => p.includes("django") || p.includes("settings.py"))) return "Django";
  if (paths.some((p) => p.includes("flask"))) return "Flask";
  return "Unknown";
}

function detectRuntime(deps: Record<string, string>, paths: string[]): string {
  if (paths.some((p) => p.endsWith(".py"))) return "Python";
  if (paths.some((p) => p.endsWith(".go"))) return "Go";
  if (paths.some((p) => p.endsWith(".rs"))) return "Rust";
  if (deps.node || paths.some((p) => p === "package.json")) return "Node.js";
  return "Unknown";
}

function detectBuildSystem(
  deps: Record<string, string>,
  paths: string[],
  scripts: Record<string, string>,
): string {
  if (deps.next) return "Next.js (Turbopack/Webpack)";
  if (deps.vite || deps["@vitejs/plugin-react"]) return "Vite";
  if (deps.webpack) return "Webpack";
  if (deps.rollup) return "Rollup";
  if (deps.esbuild) return "esbuild";
  if (deps.parcel) return "Parcel";
  if (paths.some((p) => p.includes("Makefile"))) return "Make";
  if (scripts.build?.includes("tsc")) return "TypeScript Compiler";
  return "npm scripts";
}

function detectPackageManager(paths: string[]): string {
  if (paths.some((p) => p === "bun.lockb")) return "bun";
  if (paths.some((p) => p === "pnpm-lock.yaml")) return "pnpm";
  if (paths.some((p) => p === "yarn.lock")) return "yarn";
  if (paths.some((p) => p === "package-lock.json")) return "npm";
  return "npm";
}

function detectLanguagePrimary(paths: string[]): string {
  const counts: Record<string, number> = {};
  for (const p of paths) {
    const lang = detectLanguage(p);
    counts[lang] = (counts[lang] ?? 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top?.[0] ?? "plaintext";
}

function buildSummary(
  framework: string,
  runtime: string,
  language: string,
  fileCount: number,
  lineCount: number,
  deps: Record<string, string>,
): string {
  const depCount = Object.keys(deps).length;
  return `${framework} project · ${runtime} runtime · ${fileCount} files · ${lineCount.toLocaleString()} lines · ${depCount} dependencies`;
}
