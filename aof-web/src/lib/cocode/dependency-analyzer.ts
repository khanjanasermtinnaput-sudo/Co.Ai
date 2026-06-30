// ── Smart Dependency Analyzer (Phase 26) ─────────────────────────────────────
// Analyzes imports/exports, detects circular deps, unused imports, dead code,
// large bundle contributors, and generates actionable recommendations.

export interface ImportInfo {
  source: string;       // importing file
  target: string;       // what is imported
  specifiers: string[]; // named imports
  isDefault: boolean;
  isDynamic: boolean;
  line: number;
}

export interface DependencyReport {
  imports: ImportInfo[];
  circularDeps: string[][];  // each sub-array is a cycle path
  unusedImports: Array<{ file: string; specifier: string; line: number }>;
  deadComponents: string[]; // exported but never imported anywhere
  unusedHooks: string[];
  largeBundles: Array<{ path: string; lines: number; warning: string }>;
  recommendations: Array<{ severity: "error" | "warning" | "info"; message: string; file?: string }>;
  builtAt: number;
}

// ── Regex helpers ─────────────────────────────────────────────────────────────

const IMPORT_RE = /^import\s+(?:(\w+)\s*,?\s*)?(?:\{([^}]+)\})?\s*(?:type\s+\{[^}]+\}\s*)?from\s+['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT_RE = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_RE = /^export\s+(?:default\s+)?(?:function|class|const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
const EXPORT_NAMED_RE = /^export\s*\{([^}]+)\}/gm;

function extractImports(path: string, content: string): ImportInfo[] {
  const imports: ImportInfo[] = [];
  let m: RegExpExecArray | null;

  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const line = content.slice(0, m.index).split("\n").length;
    imports.push({
      source: path,
      target: m[3],
      specifiers: m[2] ? m[2].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean) : [],
      isDefault: Boolean(m[1]),
      isDynamic: false,
      line,
    });
  }

  DYNAMIC_IMPORT_RE.lastIndex = 0;
  while ((m = DYNAMIC_IMPORT_RE.exec(content)) !== null) {
    const line = content.slice(0, m.index).split("\n").length;
    imports.push({
      source: path,
      target: m[1],
      specifiers: [],
      isDefault: true,
      isDynamic: true,
      line,
    });
  }

  return imports;
}

function extractExports(path: string, content: string): string[] {
  const names: string[] = [];
  let m: RegExpExecArray | null;

  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(content)) !== null) names.push(m[1]);

  EXPORT_NAMED_RE.lastIndex = 0;
  while ((m = EXPORT_NAMED_RE.exec(content)) !== null) {
    names.push(...m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean));
  }

  return names;
}

// ── Circular dependency detection (DFS) ──────────────────────────────────────

function detectCircular(graph: Map<string, Set<string>>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();
  const stackPath: string[] = [];

  function dfs(node: string) {
    if (stack.has(node)) {
      const cycleStart = stackPath.indexOf(node);
      if (cycleStart !== -1) {
        const cycle = stackPath.slice(cycleStart);
        // De-dup by canonical form
        const key = [...cycle].sort().join("→");
        if (!cycles.some((c) => [...c].sort().join("→") === key)) {
          cycles.push([...cycle, node]);
        }
      }
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    stackPath.push(node);
    for (const dep of graph.get(node) ?? []) dfs(dep);
    stackPath.pop();
    stack.delete(node);
  }

  for (const node of graph.keys()) dfs(node);
  return cycles;
}

// ── Main analyzer ─────────────────────────────────────────────────────────────

export function analyzeDependencies(
  files: Array<{ path: string; content: string }>,
): DependencyReport {
  const allImports: ImportInfo[] = [];
  const allExports = new Map<string, string[]>(); // path → exported names
  const importedNames = new Map<string, Set<string>>(); // specifier → set of files that import it
  const graph = new Map<string, Set<string>>(); // path → set of deps (internal only)

  for (const { path, content } of files) {
    if (!/\.(tsx?|jsx?)$/.test(path)) continue;
    const imports = extractImports(path, content);
    allImports.push(...imports);
    allExports.set(path, extractExports(path, content));

    const deps = new Set<string>();
    for (const imp of imports) {
      if (imp.target.startsWith(".")) deps.add(imp.target);
      for (const spec of imp.specifiers) {
        if (!importedNames.has(spec)) importedNames.set(spec, new Set());
        importedNames.get(spec)!.add(path);
      }
    }
    graph.set(path, deps);
  }

  // Unused imports: imported specifier never referenced in file body
  const unusedImports: DependencyReport["unusedImports"] = [];
  for (const { path, content } of files) {
    if (!/\.(tsx?|jsx?)$/.test(path)) continue;
    for (const imp of allImports.filter((i) => i.source === path)) {
      for (const spec of imp.specifiers) {
        // Count occurrences after the import line
        const importLine = content.split("\n").slice(0, imp.line).join("\n");
        const afterImport = content.slice(importLine.length);
        const count = (afterImport.match(new RegExp(`\\b${spec}\\b`, "g")) ?? []).length;
        if (count === 0) {
          unusedImports.push({ file: path, specifier: spec, line: imp.line });
        }
      }
    }
  }

  // Dead components: exported but never imported
  const allImportedSpecifiers = new Set(allImports.flatMap((i) => i.specifiers));
  const deadComponents: string[] = [];
  for (const [path, exports] of allExports) {
    for (const name of exports) {
      if (/^[A-Z]/.test(name) && !allImportedSpecifiers.has(name)) {
        deadComponents.push(`${name} (${path})`);
      }
    }
  }

  // Unused hooks
  const unusedHooks: string[] = [];
  for (const [path, content] of files.map((f) => [f.path, f.content] as const)) {
    if (!/\.(tsx?|jsx?)$/.test(path)) continue;
    const HOOK_USE = /\bconst\s+\[?(\w+)/g;
    let m: RegExpExecArray | null;
    HOOK_USE.lastIndex = 0;
    while ((m = HOOK_USE.exec(content)) !== null) {
      const name = m[1];
      if (/^use[A-Z]/.test(name)) {
        const rest = content.slice(m.index + m[0].length);
        const uses = (rest.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length;
        if (uses === 0) unusedHooks.push(`${name} (${path})`);
      }
    }
  }

  // Large bundles
  const largeBundles: DependencyReport["largeBundles"] = [];
  for (const { path, content } of files) {
    const lineCount = content.split("\n").length;
    if (lineCount > 500) {
      largeBundles.push({
        path,
        lines: lineCount,
        warning: lineCount > 1000
          ? "Very large file (>1000 lines) — consider splitting into smaller modules"
          : "Large file (>500 lines) — review for extract opportunities",
      });
    }
  }

  // Circular deps
  const circularDeps = detectCircular(graph);

  // Recommendations
  const recommendations: DependencyReport["recommendations"] = [];
  if (circularDeps.length) {
    recommendations.push({
      severity: "error",
      message: `${circularDeps.length} circular dependenc${circularDeps.length === 1 ? "y" : "ies"} detected — may cause undefined import errors`,
    });
  }
  if (unusedImports.length > 5) {
    recommendations.push({
      severity: "warning",
      message: `${unusedImports.length} unused imports found — remove to reduce bundle size`,
    });
  }
  if (deadComponents.length > 0) {
    recommendations.push({
      severity: "info",
      message: `${deadComponents.length} exported component${deadComponents.length !== 1 ? "s" : ""} never imported anywhere — possible dead code`,
    });
  }
  if (largeBundles.length > 0) {
    recommendations.push({
      severity: "warning",
      message: `${largeBundles.length} large file${largeBundles.length !== 1 ? "s" : ""} detected — splitting improves code splitting and tree-shaking`,
    });
  }

  return {
    imports: allImports,
    circularDeps,
    unusedImports: unusedImports.slice(0, 50),
    deadComponents: deadComponents.slice(0, 30),
    unusedHooks: unusedHooks.slice(0, 20),
    largeBundles,
    recommendations,
    builtAt: Date.now(),
  };
}
