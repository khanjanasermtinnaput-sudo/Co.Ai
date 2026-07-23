// Repository scanner: reads file tree, detects framework/language/package manager

import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { glob } from "glob";

// ignore is CommonJS; createRequire keeps it callable under NodeNext ESM
// (matches the createRequire pattern used in tmap-v2/src/server/redis.ts).
interface IgnoreInstance { add(patterns: string[]): IgnoreInstance; ignores(path: string): boolean; }
const _require = createRequire(import.meta.url);
const ignore = _require("ignore") as () => IgnoreInstance;

export interface RepoInfo {
  root: string;
  framework: string;
  language: string;
  packageManager: string;
  buildSystem: string;
  languages: string[];
  files: string[];
  fileCount: number;
  totalLines: number;
}

export interface FileContext {
  path: string;      // relative to repo root
  content: string;
  lines: number;
}

const IGNORE_PATTERNS = [
  ".git/**",
  "node_modules/**",
  "dist/**",
  "build/**",
  ".next/**",
  "__pycache__/**",
  "*.pyc",
  ".venv/**",
  "venv/**",
  ".env",
  ".env.*",
  "*.log",
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "*.min.js",
  "*.min.css",
  "*.map",
  "coverage/**",
  ".cache/**",
];

function detectFramework(root: string, files: string[]): string {
  const pkg = tryReadJson(join(root, "package.json")) as Record<string, Record<string, string>> | null;
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps["next"])    return "Next.js";
    if (deps["nuxt"])    return "Nuxt";
    if (deps["@angular/core"]) return "Angular";
    if (deps["react"])   return "React";
    if (deps["vue"])     return "Vue";
    if (deps["svelte"])  return "Svelte";
    if (deps["express"]) return "Express";
    if (deps["fastify"]) return "Fastify";
  }
  if (files.some((f) => f.includes("manage.py")))         return "Django";
  if (files.some((f) => f.includes("app/Http")))          return "Laravel";
  if (files.some((f) => f.endsWith("main.go")))           return "Go";
  if (files.some((f) => f.endsWith("Cargo.toml")))        return "Rust";
  if (files.some((f) => f.includes("pubspec.yaml")))      return "Flutter";
  if (files.some((f) => f.endsWith(".csproj")))           return ".NET";
  if (files.some((f) => f.endsWith("pom.xml") || f.endsWith("build.gradle"))) return "Java/Spring";
  return "Unknown";
}

function detectLanguages(files: string[]): string[] {
  const extMap: Record<string, string> = {
    ".ts": "TypeScript", ".tsx": "TypeScript",
    ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
    ".py": "Python",
    ".go": "Go",
    ".rs": "Rust",
    ".java": "Java",
    ".cs": "C#",
    ".php": "PHP",
    ".dart": "Dart",
    ".swift": "Swift",
    ".kt": "Kotlin",
    ".rb": "Ruby",
    ".cpp": "C++", ".cc": "C++", ".cxx": "C++",
    ".c": "C",
    ".html": "HTML",
    ".css": "CSS", ".scss": "CSS", ".sass": "CSS",
    ".sql": "SQL",
    ".sh": "Shell",
  };
  const counts: Record<string, number> = {};
  for (const f of files) {
    const lang = extMap[extname(f)];
    if (lang) counts[lang] = (counts[lang] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([l]) => l);
}

function detectPackageManager(root: string): string {
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock")))       return "yarn";
  if (existsSync(join(root, "bun.lockb")))       return "bun";
  if (existsSync(join(root, "package-lock.json"))) return "npm";
  if (existsSync(join(root, "requirements.txt"))) return "pip";
  if (existsSync(join(root, "Cargo.toml")))       return "cargo";
  if (existsSync(join(root, "go.mod")))           return "go modules";
  if (existsSync(join(root, "pubspec.yaml")))     return "flutter pub";
  if (existsSync(join(root, "*.csproj")))         return "dotnet";
  return "unknown";
}

function detectBuildSystem(root: string): string {
  if (existsSync(join(root, "next.config.js")) || existsSync(join(root, "next.config.ts"))) return "Next.js";
  if (existsSync(join(root, "vite.config.ts")) || existsSync(join(root, "vite.config.js"))) return "Vite";
  if (existsSync(join(root, "webpack.config.js")))  return "Webpack";
  if (existsSync(join(root, "rollup.config.js")))   return "Rollup";
  if (existsSync(join(root, "esbuild.config.js")))  return "esbuild";
  if (existsSync(join(root, "Makefile")))            return "Make";
  if (existsSync(join(root, "Cargo.toml")))          return "cargo";
  if (existsSync(join(root, "pom.xml")))             return "Maven";
  if (existsSync(join(root, "build.gradle")))        return "Gradle";
  return "unknown";
}

function tryReadJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export async function scanRepository(root: string, maxFiles = 500): Promise<RepoInfo> {
  const ig = ignore().add(IGNORE_PATTERNS);

  const allFiles = await glob("**/*", {
    cwd: root,
    nodir: true,
    dot: false,
    absolute: false,
  });

  const files = allFiles.filter((f) => !ig.ignores(f)).slice(0, maxFiles);

  let totalLines = 0;
  for (const f of files) {
    try {
      const content = readFileSync(join(root, f), "utf8");
      totalLines += content.split("\n").length;
    } catch {
      // binary or unreadable — skip
    }
  }

  return {
    root,
    framework:      detectFramework(root, files),
    language:       detectLanguages(files)[0] ?? "Unknown",
    packageManager: detectPackageManager(root),
    buildSystem:    detectBuildSystem(root),
    languages:      detectLanguages(files),
    files,
    fileCount:      files.length,
    totalLines,
  };
}

/**
 * Build a compact context string from repo files — feeds the AI agents.
 * Caps total characters so we don't overflow context windows.
 */
export async function buildRepoContext(
  root: string,
  info: RepoInfo,
  maxChars = 40_000,
): Promise<string> {
  const ig = ignore().add(IGNORE_PATTERNS);

  // Prioritise small, important files first.
  const priority = [
    "package.json", "tsconfig.json", "README.md",
    "src/index.ts", "src/index.js", "src/main.ts",
    "src/app.ts", "src/server.ts",
  ];
  const sorted = [
    ...info.files.filter((f) => priority.some((p) => f.endsWith(p))),
    ...info.files.filter((f) => !priority.some((p) => f.endsWith(p))),
  ];

  const parts: string[] = [
    `=== Repository: ${root} ===`,
    `Framework: ${info.framework}`,
    `Language(s): ${info.languages.join(", ")}`,
    `Package manager: ${info.packageManager}`,
    `Files: ${info.fileCount} | Lines: ${info.totalLines}`,
    "",
  ];
  let total = parts.join("\n").length;

  for (const rel of sorted) {
    if (ig.ignores(rel)) continue;
    const abs = join(root, rel);
    let content: string;
    try {
      const raw = readFileSync(abs, "utf8");
      // Skip binary-ish files.
      if (/[\x00-\x08\x0e-\x1f]/.test(raw.slice(0, 256))) continue;
      content = raw;
    } catch {
      continue;
    }
    const chunk = `\n--- ${rel} ---\n${content}\n`;
    if (total + chunk.length > maxChars) break;
    parts.push(chunk);
    total += chunk.length;
  }

  return parts.join("\n");
}

export function readFile(root: string, rel: string): FileContext {
  const abs = join(root, rel);
  const content = readFileSync(abs, "utf8");
  return { path: rel, content, lines: content.split("\n").length };
}
