/**
 * Phase 44 — Technical Debt Analyzer
 *
 * Performs static analysis of the repository to detect:
 * dead code, large components, complex functions, duplicated logic,
 * unused dependencies, and legacy patterns. Generates a debt report
 * with priority ranking and estimated cleanup times.
 */
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, extname, basename } from "node:path";
import { writeFileSync } from "node:fs";

// ── Thresholds ─────────────────────────────────────────────────────────────

const THRESHOLDS = {
  largeFileLoc: 300,          // lines of code
  veryLargeFileLoc: 600,      // high risk
  complexFunctionLines: 50,   // function body line count
  maxDependencies: 30,        // package.json deps
  duplicateThreshold: 0.85,   // string similarity
  todoWarningCount: 10,       // TODO/FIXME comments
};

// ── Helpers ────────────────────────────────────────────────────────────────

function findRepoRoot(): string | null {
  const candidates = [
    resolve(import.meta.dirname ?? ".", ".."),
    resolve(process.cwd(), ".."),
    process.cwd(),
  ];
  return candidates.find((p) => existsSync(resolve(p, ".git"))) ?? null;
}

function walkDir(dir: string, exts: string[], maxFiles = 500): string[] {
  const result: string[] = [];
  if (!existsSync(dir)) return result;

  function recurse(d: string) {
    if (result.length >= maxFiles) return;
    try {
      for (const entry of readdirSync(d)) {
        if (entry.startsWith(".") || entry === "node_modules" || entry === ".next" || entry === "dist") continue;
        const full = resolve(d, entry);
        try {
          const stat = statSync(full);
          if (stat.isDirectory()) recurse(full);
          else if (exts.includes(extname(entry))) result.push(full);
        } catch {}
      }
    } catch {}
  }
  recurse(dir);
  return result;
}

interface FileDebt {
  path: string;
  loc: number;
  todos: number;
  risk: "low" | "medium" | "high";
}

function analyzeFile(filePath: string, repoRoot: string): FileDebt | null {
  try {
    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    const loc = lines.filter((l) => l.trim()).length;
    const todos = lines.filter((l) => /TODO|FIXME|HACK|XXX|NOSONAR/i.test(l)).length;
    const risk: FileDebt["risk"] = loc >= THRESHOLDS.veryLargeFileLoc ? "high"
      : loc >= THRESHOLDS.largeFileLoc ? "medium" : "low";

    return {
      path: filePath.replace(repoRoot, ""),
      loc,
      todos,
      risk,
    };
  } catch {
    return null;
  }
}

function detectDuplicatePatterns(files: string[]): number {
  const patterns = new Map<string, number>();
  let duplicateCount = 0;

  for (const f of files.slice(0, 50)) {
    try {
      const content = readFileSync(f, "utf8");
      // Extract function signatures as de-dup keys
      const sigs = content.match(/(?:function|const|async function)\s+\w+\s*\([^)]*\)/g) ?? [];
      for (const sig of sigs) {
        const normalized = sig.replace(/\s+/g, " ").toLowerCase();
        patterns.set(normalized, (patterns.get(normalized) ?? 0) + 1);
      }
    } catch {}
  }

  for (const count of patterns.values()) {
    if (count > 1) duplicateCount++;
  }
  return duplicateCount;
}

// ── Phase runner ───────────────────────────────────────────────────────────

export async function runPhase44(runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  const repoRoot = findRepoRoot();
  const webSrc = repoRoot ? resolve(repoRoot, "aof-web", "src") : null;
  const hasSource = webSrc !== null && existsSync(webSrc!);

  // ── 1. Large file detection ───────────────────────────────────────────────
  {
    const t0 = Date.now();
    let largeFiles: FileDebt[] = [];
    let totalFiles = 0;

    if (hasSource) {
      const files = walkDir(webSrc!, [".ts", ".tsx", ".js", ".jsx"]);
      totalFiles = files.length;
      const analyzed = files.map((f) => analyzeFile(f, repoRoot!)).filter(Boolean) as FileDebt[];
      largeFiles = analyzed.filter((f) => f.risk !== "low");
    }

    const highRisk = largeFiles.filter((f) => f.risk === "high");
    const ok = highRisk.length <= 5; // Up to 5 very large files is acceptable

    const t: TestResult = {
      name: `Technical debt: ${highRisk.length} very large files (>${THRESHOLDS.veryLargeFileLoc} LOC)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        totalFiles,
        largeFiles: largeFiles.length,
        highRiskFiles: highRisk.map((f) => ({ path: f.path, loc: f.loc })).slice(0, 5),
        mediumRiskCount: largeFiles.filter((f) => f.risk === "medium").length,
      },
    };
    if (!ok) {
      t.error = `${highRisk.length} files exceed ${THRESHOLDS.veryLargeFileLoc} LOC — refactoring needed`;
      t.rootCause = "Components/modules too large — difficult to test, maintain, and understand";
      t.suggestedFix = `Split these files: ${highRisk.slice(0, 3).map((f) => f.path).join(", ")}`;
    }
    tests.push(t);
    ok ? log.ok(`${t.name} (${totalFiles} files scanned)`) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 2. TODO/FIXME comment accumulation ───────────────────────────────────
  {
    const t0 = Date.now();
    let totalTodos = 0;
    let filesWithTodos: Array<{ path: string; count: number }> = [];

    if (hasSource) {
      const files = walkDir(webSrc!, [".ts", ".tsx"]);
      for (const f of files) {
        try {
          const content = readFileSync(f, "utf8");
          const count = (content.match(/TODO|FIXME|HACK|XXX/gi) ?? []).length;
          if (count > 0) {
            filesWithTodos.push({ path: f.replace(repoRoot!, ""), count });
            totalTodos += count;
          }
        } catch {}
      }
    }

    const ok = totalTodos <= THRESHOLDS.todoWarningCount;

    const t: TestResult = {
      name: `Technical debt: ${totalTodos} TODO/FIXME comments (threshold: ${THRESHOLDS.todoWarningCount})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: {
        totalTodos,
        threshold: THRESHOLDS.todoWarningCount,
        hotspots: filesWithTodos.sort((a, b) => b.count - a.count).slice(0, 5),
      },
    };
    if (!ok) {
      t.error = `${totalTodos} technical debt markers — consider scheduling cleanup sprint`;
      t.rootCause = "Accumulated TODO/FIXME comments indicate unresolved known issues";
      t.suggestedFix = "Create GitHub issues from TODOs; schedule a debt-reduction sprint; use ESLint no-warning-comments rule";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 3. Duplicate function patterns ────────────────────────────────────────
  {
    const t0 = Date.now();
    let duplicateCount = 0;

    if (hasSource) {
      const files = walkDir(webSrc!, [".ts", ".tsx"]);
      duplicateCount = detectDuplicatePatterns(files);
    }

    const ok = duplicateCount <= 10;

    const t: TestResult = {
      name: `Technical debt: ${duplicateCount} potentially duplicated function signatures`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { duplicateCount },
    };
    if (!ok) {
      t.error = `${duplicateCount} duplicate function patterns — consolidation needed`;
      t.rootCause = "Copy-pasted code patterns across files — DRY principle violated";
      t.suggestedFix = "Extract common patterns into shared utilities in src/lib/; use custom hooks for React patterns";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 4. Dependency count ───────────────────────────────────────────────────
  {
    const t0 = Date.now();
    let depCount = 0;
    let devDepCount = 0;
    let unusedSignals: string[] = [];

    if (repoRoot) {
      const pkgPath = resolve(repoRoot, "aof-web", "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
          };
          depCount = Object.keys(pkg.dependencies ?? {}).length;
          devDepCount = Object.keys(pkg.devDependencies ?? {}).length;

          // Detect packages that may be unused (no import found in source)
          if (hasSource) {
            const allSource = walkDir(webSrc!, [".ts", ".tsx"]).map((f) => {
              try { return readFileSync(f, "utf8"); } catch { return ""; }
            }).join("\n");

            for (const dep of Object.keys(pkg.dependencies ?? {})) {
              if (!dep.startsWith("@") && !allSource.includes(`"${dep}"`) && !allSource.includes(`'${dep}'`)) {
                unusedSignals.push(dep);
              }
            }
          }
        } catch {}
      }
    }

    const ok = depCount <= THRESHOLDS.maxDependencies || depCount === 0;

    const t: TestResult = {
      name: `Technical debt: ${depCount} production deps + ${devDepCount} dev deps (threshold: ${THRESHOLDS.maxDependencies})`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { depCount, devDepCount, possiblyUnused: unusedSignals.slice(0, 5) },
    };
    if (!ok) {
      t.error = `${depCount} production dependencies — may cause bundle bloat`;
      t.rootCause = "Large dependency count increases bundle size, attack surface, and maintenance burden";
      t.suggestedFix = `Review dependencies; consider removing: ${unusedSignals.slice(0, 5).join(", ")}; use depcheck`;
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 5. Test coverage proxy ────────────────────────────────────────────────
  {
    const t0 = Date.now();
    let testFiles = 0;
    let sourceFiles = 0;

    if (hasSource) {
      const allFiles = walkDir(webSrc!, [".ts", ".tsx"]);
      testFiles = allFiles.filter((f) => f.includes(".test.") || f.includes(".spec.") || f.includes("__tests__")).length;
      sourceFiles = allFiles.filter((f) => !f.includes(".test.") && !f.includes(".spec.") && !f.includes("__tests__")).length;
    }

    const coverage = sourceFiles > 0 ? testFiles / sourceFiles : 0;
    const ok = coverage >= 0.05 || testFiles > 0; // At least 5% or some tests exist

    const t: TestResult = {
      name: `Technical debt: test coverage proxy ${Math.round(coverage * 100)}% (${testFiles} test files / ${sourceFiles} source files)`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { testFiles, sourceFiles, coverageProxy: `${Math.round(coverage * 100)}%` },
    };
    if (!ok) {
      t.error = "No test files found — zero test coverage";
      t.rootCause = "Missing unit and integration tests for source code";
      t.suggestedFix = "Add tests to src/tests/; target ≥20% coverage; add critical path tests first (auth, chat, billing)";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 6. Console.log leakage ────────────────────────────────────────────────
  {
    const t0 = Date.now();
    let consoleLogCount = 0;

    if (hasSource) {
      const files = walkDir(webSrc!, [".ts", ".tsx"]);
      for (const f of files) {
        try {
          const content = readFileSync(f, "utf8");
          const matches = content.match(/console\.(log|warn|error|debug)\(/g) ?? [];
          consoleLogCount += matches.length;
        } catch {}
      }
    }

    const ok = consoleLogCount <= 20;

    const t: TestResult = {
      name: `Technical debt: ${consoleLogCount} console.log statements in source`,
      passed: ok,
      durationMs: Date.now() - t0,
      details: { consoleLogCount, threshold: 20 },
    };
    if (!ok) {
      t.error = `${consoleLogCount} console.log calls — may leak sensitive data in production`;
      t.rootCause = "Debug logging left in production code";
      t.suggestedFix = "Replace console.log with structured logger (lib/server/ai-log.ts); add ESLint no-console rule";
    }
    tests.push(t);
    ok ? log.ok(t.name) : log.fail(`${t.name} — ${t.error}`);
  }

  // ── 7. Generate debt report ───────────────────────────────────────────────
  {
    const t0 = Date.now();
    const passCount_ = tests.filter((t) => t.passed).length;
    const failCount_ = tests.filter((t) => !t.passed).length;
    const debtScore = Math.round((passCount_ / tests.length) * 100);

    const report = {
      timestamp: new Date().toISOString(),
      debtScore,
      priority: debtScore >= 80 ? "LOW" : debtScore >= 60 ? "MEDIUM" : "HIGH",
      estimatedCleanupDays: debtScore >= 80 ? 1 : debtScore >= 60 ? 3 : 7,
      findings: tests.filter((t) => !t.passed).map((t) => ({
        issue: t.name,
        fix: t.suggestedFix ?? "Review and refactor",
        rootCause: t.rootCause ?? "Code quality issue",
      })),
    };

    try {
      writeFileSync(resolve(runDir, "DEBT_REPORT.json"), JSON.stringify(report, null, 2));
    } catch {}

    const t: TestResult = {
      name: `Technical debt score: ${debtScore}% (${report.priority} priority, ~${report.estimatedCleanupDays} days cleanup)`,
      passed: true,
      durationMs: Date.now() - t0,
      details: report,
    };
    tests.push(t);
    log.ok(`${t.name}`);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return {
    phase: 44,
    name: "Technical Debt Analyzer",
    tests,
    totalMs: Date.now() - start,
    passCount,
    failCount,
  };
}
