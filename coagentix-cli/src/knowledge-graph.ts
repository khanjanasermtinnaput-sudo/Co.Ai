// Intelligent Context Manager: project knowledge graph
// Stores file relationships, API routes, component hierarchy, DB schema, dependencies

import {
  readFileSync, writeFileSync, mkdirSync, existsSync, statSync,
} from "node:fs";
import { join, extname, basename } from "node:path";
import { globSync } from "glob";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FileNode {
  path: string;
  type: "component" | "api" | "util" | "config" | "style" | "test" | "schema" | "other";
  imports: string[];
  exports: string[];
  apiRoutes?: string[];
  size: number;
  updatedAt: string;
}

export interface KnowledgeGraph {
  version: 2;
  builtAt: string;
  root: string;
  files: Record<string, FileNode>;
  dependencies: Record<string, string>;   // package name → version
  entryPoints: string[];
  apiRoutes: string[];
  schemaFiles: string[];
}

// ── File Classification ────────────────────────────────────────────────────────

function classifyFile(path: string, _content: string): FileNode["type"] {
  const p = path.toLowerCase();
  if (p.includes(".test.") || p.includes(".spec.") || p.includes("__tests__")) return "test";
  if (p.includes("/api/") || p.includes("route.ts") || p.includes("handler.ts")) return "api";
  if (/schema|migration|prisma/.test(p)) return "schema";
  if (/\.css$|\.scss$|\.sass$|tailwind/.test(p)) return "style";
  if (/\.config\.|tsconfig|eslint|prettier|next\.config/.test(p)) return "config";
  if (/component|page|layout|view|widget/.test(p)) return "component";
  if (/util|helper|lib|service|hook/.test(p)) return "util";
  return "other";
}

function extractImports(content: string, ext: string): string[] {
  if (![".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(ext)) return [];
  const imports: string[] = [];
  const re = /(?:import|from)\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    imports.push(m[1]!);
  }
  return [...new Set(imports)];
}

function extractExports(content: string, ext: string): string[] {
  if (![".ts", ".tsx", ".js", ".jsx", ".mjs"].includes(ext)) return [];
  const exports: string[] = [];
  const re = /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    exports.push(m[1]!);
  }
  return [...new Set(exports)];
}

function extractApiRoutes(path: string, content: string): string[] {
  const routes: string[] = [];
  // Next.js App Router route handlers
  if (/route\.(ts|js)$/.test(path)) {
    const methods = content.match(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH)/g) ?? [];
    const routePath = path.replace(/.*app/, "").replace(/route\.(ts|js)$/, "").replace(/\\/g, "/");
    for (const m of methods) {
      const method = m.replace(/export\s+(?:async\s+)?function\s+/, "");
      routes.push(`${method} ${routePath}`);
    }
  }
  // Express-style routes
  const expressRe = /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = expressRe.exec(content)) !== null) {
    routes.push(`${m[1]!.toUpperCase()} ${m[2]!}`);
  }
  return routes;
}

// ── Build Graph ────────────────────────────────────────────────────────────────

export async function buildKnowledgeGraph(root: string): Promise<KnowledgeGraph> {
  const patterns = [
    "**/*.{ts,tsx,js,jsx,mjs,cjs}",
    "**/*.{prisma,sql}",
    "**/package.json",
  ];
  const ignore = ["node_modules/**", ".next/**", "dist/**", "build/**", "*.min.js"];

  const filePaths = globSync(patterns, { cwd: root, ignore, absolute: false });

  const files: Record<string, FileNode> = {};
  const allApiRoutes: string[] = [];
  const schemaFiles: string[] = [];

  for (const rel of filePaths) {
    const abs = join(root, rel);
    let content = "";
    try {
      const stat = statSync(abs);
      if (stat.size > 500_000) continue; // skip files > 500 KB
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }

    const ext      = extname(rel);
    const type     = classifyFile(rel, content);
    const imports  = extractImports(content, ext);
    const exports  = extractExports(content, ext);
    const apiRoutes = extractApiRoutes(rel, content);

    if (apiRoutes.length > 0) allApiRoutes.push(...apiRoutes);
    if (type === "schema") schemaFiles.push(rel);

    files[rel] = {
      path: rel,
      type,
      imports,
      exports,
      apiRoutes: apiRoutes.length > 0 ? apiRoutes : undefined,
      size: content.length,
      updatedAt: statSync(abs).mtime.toISOString(),
    };
  }

  // Extract dependencies from package.json
  const pkgPath = join(root, "package.json");
  let dependencies: Record<string, string> = {};
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch { /* ignore */ }
  }

  // Detect entry points
  const entryPoints = Object.keys(files).filter((p) =>
    /^(src\/)?index\.(ts|js|tsx|jsx)$/.test(p) ||
    /^(src\/)?main\.(ts|js)$/.test(p) ||
    /^app\/(page|layout)\.(tsx|jsx)$/.test(p),
  );

  const graph: KnowledgeGraph = {
    version: 2,
    builtAt: new Date().toISOString(),
    root,
    files,
    dependencies,
    entryPoints,
    apiRoutes: [...new Set(allApiRoutes)],
    schemaFiles,
  };

  // Persist cache
  try {
    mkdirSync(join(root, ".coai-cache"), { recursive: true });
    writeFileSync(join(root, ".coai-cache", "graph.json"), JSON.stringify(graph));
  } catch { /* non-fatal */ }

  return graph;
}

export function loadCachedGraph(root: string, maxAgeMs = 5 * 60_000): KnowledgeGraph | null {
  const cachePath = join(root, ".coai-cache", "graph.json");
  if (!existsSync(cachePath)) return null;
  try {
    const graph = JSON.parse(readFileSync(cachePath, "utf8")) as KnowledgeGraph;
    if (Date.now() - new Date(graph.builtAt).getTime() > maxAgeMs) return null;
    return graph;
  } catch {
    return null;
  }
}

export async function getOrBuildGraph(root: string): Promise<KnowledgeGraph> {
  return loadCachedGraph(root) ?? buildKnowledgeGraph(root);
}

// ── Query Helpers ──────────────────────────────────────────────────────────────

export function getRelatedFiles(graph: KnowledgeGraph, filePath: string): string[] {
  const node = graph.files[filePath];
  if (!node) return [];

  const related = new Set<string>();

  // Files this file imports
  for (const imp of node.imports) {
    const match = Object.keys(graph.files).find((p) => p.includes(imp.replace(/^\.\//, "").replace(/^\.\.\//, "")));
    if (match) related.add(match);
  }

  // Files that import this file
  const name = basename(filePath).replace(/\.(ts|tsx|js|jsx)$/, "");
  for (const [path, n] of Object.entries(graph.files)) {
    if (n.imports.some((i) => i.includes(name) || i.includes(filePath))) {
      related.add(path);
    }
  }

  related.delete(filePath);
  return [...related];
}

export function summarizeGraph(graph: KnowledgeGraph): string {
  const counts = Object.values(graph.files).reduce((acc, f) => {
    acc[f.type] = (acc[f.type] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const lines = [
    `Files: ${Object.keys(graph.files).length}`,
    `Types: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`,
    `API Routes: ${graph.apiRoutes.length}`,
    `Schemas: ${graph.schemaFiles.length}`,
    `Entry Points: ${graph.entryPoints.join(", ") || "none"}`,
  ];

  return lines.join("\n");
}
