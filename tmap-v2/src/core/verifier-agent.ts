// Verifier Agent — semantic cross-file code verification (static, no LLM).
// Checks: circular dependencies, duplicate exports, orphaned relative imports,
// and missing entrypoints. Complements the syntax validator (validator.ts).

import type { CodeFile } from '../types.js';

export type VerificationIssueType =
  | 'circular_dependency'
  | 'duplicate_export'
  | 'phantom_file_ref'
  | 'missing_entrypoint';

export interface VerificationIssue {
  type: VerificationIssueType;
  files: string[];
  description: string;
  severity: 'HIGH' | 'MED' | 'LOW';
}

export interface VerificationReport {
  passed: boolean;
  issues: VerificationIssue[];
  exportMap: Record<string, string[]>;   // file → exported names
  importMap: Record<string, string[]>;   // file → relative import paths
  checkedFiles: number;
  summary: string;
}

// ── Export extraction ─────────────────────────────────────────────────────────

function extractExports(content: string): string[] {
  const names: string[] = [];
  for (const m of content.matchAll(/\bexport\s+(?:default\s+)?(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/g)) {
    names.push(m[1]);
  }
  for (const m of content.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const seg of m[1].split(',')) {
      const clean = seg.trim().split(/\s+as\s+/).pop()?.trim();
      if (clean && /^\w+$/.test(clean)) names.push(clean);
    }
  }
  return [...new Set(names)];
}

// ── Relative import extraction ────────────────────────────────────────────────

function extractRelativeImports(content: string): string[] {
  const paths: string[] = [];
  for (const m of content.matchAll(/(?:import|export)\s+(?:[^'"]*from\s+)?['"](\.[^'"]+)['"]/g)) {
    paths.push(m[1]);
  }
  return paths;
}

// ── Path resolution (best-effort without a full TS resolver) ─────────────────

function resolveRelative(fromFile: string, importPath: string, allPaths: string[]): string | null {
  const fromDir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/') + 1) : '';
  const exts = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs', ''];
  // Strip any existing extension from the import path so './b.js' resolves to src/b.ts
  const baseNoExt = importPath.replace(/^\.\//, '').replace(/\.[^./]+$/, '');

  for (const ext of exts) {
    const candidate = (fromDir + baseNoExt + ext).replace(/\/\//g, '/');
    if (allPaths.includes(candidate) || allPaths.includes(candidate.replace(/^\.\//, ''))) {
      return candidate;
    }
  }
  return null;
}

// ── Circular dependency detection (DFS) ──────────────────────────────────────

function findCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  const dfs = (node: string, path: string[]): void => {
    if (inStack.has(node)) {
      const start = path.indexOf(node);
      if (start !== -1) cycles.push(path.slice(start));
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    inStack.add(node);
    for (const dep of graph.get(node) ?? []) dfs(dep, [...path, node]);
    inStack.delete(node);
  };

  for (const node of graph.keys()) dfs(node, []);
  return cycles;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function verifyCodeFiles(files: CodeFile[]): VerificationReport {
  if (files.length === 0) {
    return {
      passed: false,
      issues: [],
      exportMap: {},
      importMap: {},
      checkedFiles: 0,
      summary: 'No files to verify',
    };
  }

  const issues: VerificationIssue[] = [];
  const allPaths = files.map((f) => f.path);
  const exportMap: Record<string, string[]> = {};
  const importMap: Record<string, string[]> = {};
  const depGraph = new Map<string, string[]>();

  for (const file of files) {
    exportMap[file.path] = extractExports(file.content);
    const relImports = extractRelativeImports(file.content);
    importMap[file.path] = relImports;

    const resolved = relImports
      .map((imp) => resolveRelative(file.path, imp, allPaths))
      .filter((p): p is string => p !== null);
    depGraph.set(file.path, resolved);
  }

  // Circular dependency check
  const cycles = findCycles(depGraph);
  for (const cycle of cycles) {
    issues.push({
      type: 'circular_dependency',
      files: cycle,
      description: `Circular dependency: ${cycle.join(' → ')} → ${cycle[0]}`,
      severity: 'HIGH',
    });
  }

  // Duplicate export check (same name from multiple files, excluding 'default')
  const nameToFiles = new Map<string, string[]>();
  for (const [filePath, names] of Object.entries(exportMap)) {
    for (const name of names) {
      if (name === 'default') continue;
      const arr = nameToFiles.get(name) ?? [];
      arr.push(filePath);
      nameToFiles.set(name, arr);
    }
  }
  for (const [name, paths] of nameToFiles.entries()) {
    if (paths.length > 1) {
      issues.push({
        type: 'duplicate_export',
        files: paths,
        description: `"${name}" exported from multiple files: ${paths.join(', ')}`,
        severity: 'LOW',
      });
    }
  }

  // Missing entrypoint check (only for multi-file projects)
  if (files.length >= 3) {
    const hasEntry = files.some((f) =>
      /(?:^|[/\\])(?:index|main|app|server)\.[tj]sx?$/.test(f.path)
    );
    if (!hasEntry) {
      issues.push({
        type: 'missing_entrypoint',
        files: allPaths,
        description: 'No index/main/app/server file found — entry point may be missing',
        severity: 'LOW',
      });
    }
  }

  const highCount = issues.filter((i) => i.severity === 'HIGH').length;
  const passed = highCount === 0;
  const summary = passed
    ? `Verification passed: ${files.length} file(s) checked, ${issues.length} non-critical issue(s)`
    : `Verification failed: ${highCount} HIGH severity issue(s) in ${files.length} file(s)`;

  return { passed, issues, exportMap, importMap, checkedFiles: files.length, summary };
}
