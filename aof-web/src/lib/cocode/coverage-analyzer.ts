// ── Code Coverage Analyzer (Phase 49) ────────────────────────────────────────
// Parses Istanbul/V8 coverage JSON reports and computes per-file metrics.
// Also estimates theoretical coverage from test files in the virtual FS.

export interface LineCoverage {
  line: number;
  hits: number;
  covered: boolean;
}

export interface FileCoverage {
  path: string;
  statements: { total: number; covered: number; pct: number };
  branches: { total: number; covered: number; pct: number };
  functions: { total: number; covered: number; pct: number };
  lines: { total: number; covered: number; pct: number };
  lineData: LineCoverage[];
  grade: "A" | "B" | "C" | "D" | "F";
}

export interface CoverageReport {
  files: FileCoverage[];
  summary: FileCoverage["statements"] & { grade: "A" | "B" | "C" | "D" | "F" };
  generatedAt: string;
  source: "istanbul" | "v8" | "estimated";
}

function grade(pct: number): FileCoverage["grade"] {
  if (pct >= 90) return "A";
  if (pct >= 75) return "B";
  if (pct >= 60) return "C";
  if (pct >= 40) return "D";
  return "F";
}

// ── Istanbul JSON parser ──────────────────────────────────────────────────────

interface IstanbulFileCoverage {
  path?: string;
  s: Record<string, number>;
  b: Record<string, number[]>;
  f: Record<string, number>;
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  branchMap: Record<string, unknown>;
  fnMap: Record<string, unknown>;
}

export function parseIstanbulReport(json: string): CoverageReport | null {
  try {
    const raw = JSON.parse(json) as Record<string, IstanbulFileCoverage>;
    const files: FileCoverage[] = [];

    for (const [filePath, data] of Object.entries(raw)) {
      const stmtValues = Object.values(data.s);
      const stmtCovered = stmtValues.filter((v) => v > 0).length;
      const stmtTotal = stmtValues.length;

      const branchValues = Object.values(data.b).flat();
      const branchCovered = branchValues.filter((v) => v > 0).length;
      const branchTotal = branchValues.length;

      const fnValues = Object.values(data.f);
      const fnCovered = fnValues.filter((v) => v > 0).length;
      const fnTotal = fnValues.length;

      // Build line data from statement map
      const lineHits: Record<number, number> = {};
      for (const [stmtId, loc] of Object.entries(data.statementMap)) {
        const hits = data.s[stmtId] ?? 0;
        for (let l = loc.start.line; l <= loc.end.line; l++) {
          lineHits[l] = (lineHits[l] ?? 0) + hits;
        }
      }
      const lineData: LineCoverage[] = Object.entries(lineHits).map(([l, hits]) => ({
        line: Number(l),
        hits,
        covered: hits > 0,
      }));
      const lineCovered = lineData.filter((l) => l.covered).length;
      const stmtPct = stmtTotal ? Math.round((stmtCovered / stmtTotal) * 100) : 100;

      files.push({
        path: filePath,
        statements: { total: stmtTotal, covered: stmtCovered, pct: stmtPct },
        branches: { total: branchTotal, covered: branchCovered, pct: branchTotal ? Math.round((branchCovered / branchTotal) * 100) : 100 },
        functions: { total: fnTotal, covered: fnCovered, pct: fnTotal ? Math.round((fnCovered / fnTotal) * 100) : 100 },
        lines: { total: lineData.length, covered: lineCovered, pct: lineData.length ? Math.round((lineCovered / lineData.length) * 100) : 100 },
        lineData,
        grade: grade(stmtPct),
      });
    }

    const totals = files.reduce(
      (acc, f) => ({
        total: acc.total + f.statements.total,
        covered: acc.covered + f.statements.covered,
      }),
      { total: 0, covered: 0 },
    );
    const totalPct = totals.total ? Math.round((totals.covered / totals.total) * 100) : 100;

    return { files, summary: { total: totals.total, covered: totals.covered, pct: totalPct, grade: grade(totalPct) }, generatedAt: new Date().toISOString(), source: "istanbul" };
  } catch {
    return null;
  }
}

// ── Estimated coverage from test file analysis ────────────────────────────────

export function estimateCoverage(
  sourceFiles: Array<{ path: string; content: string }>,
  testFiles: Array<{ path: string; content: string }>,
): CoverageReport {
  const files: FileCoverage[] = [];

  for (const { path, content } of sourceFiles) {
    if (!path.match(/\.(tsx?|jsx?)$/) || path.includes(".test.") || path.includes(".spec.")) continue;

    const baseName = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    const hasTest = testFiles.some((t) =>
      t.path.includes(baseName) ||
      t.content.includes(`from './${baseName}'`) ||
      t.content.includes(`from "../${baseName}"`)
    );

    // Estimate based on test coverage
    const fnMatches = content.match(/(?:function|=>)\s*(?:\w+\s*)?\(/g) ?? [];
    const fnTotal = fnMatches.length;
    const pct = hasTest ? 75 : 0;

    files.push({
      path,
      statements: { total: fnTotal * 3, covered: Math.round(fnTotal * 3 * (pct / 100)), pct },
      branches: { total: fnTotal, covered: Math.round(fnTotal * (pct / 100)), pct },
      functions: { total: fnTotal, covered: Math.round(fnTotal * (pct / 100)), pct },
      lines: { total: content.split("\n").length, covered: Math.round(content.split("\n").length * (pct / 100)), pct },
      lineData: [],
      grade: grade(pct),
    });
  }

  const totals = files.reduce(
    (acc, f) => ({ total: acc.total + f.lines.total, covered: acc.covered + f.lines.covered }),
    { total: 0, covered: 0 },
  );
  const totalPct = totals.total ? Math.round((totals.covered / totals.total) * 100) : 0;

  return { files, summary: { total: totals.total, covered: totals.covered, pct: totalPct, grade: grade(totalPct) }, generatedAt: new Date().toISOString(), source: "estimated" };
}
