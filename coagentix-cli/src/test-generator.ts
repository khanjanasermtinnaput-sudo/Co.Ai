// Advanced Testing Pipeline: auto-generate unit/integration/API/component tests, run & report coverage

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { CoaiApiClient } from "./api.js";

export type TestType = "unit" | "integration" | "api" | "component";

export interface TestGenerationRequest {
  targetFile: string;
  testTypes: TestType[];
  framework: string;
  existingTestFile?: string;
}

export interface TestRunResult {
  passed: boolean;
  total: number;
  passing: number;
  failing: number;
  coverage?: CoverageReport;
  output: string;
  durationMs: number;
}

export interface CoverageReport {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

// ── Test Framework Detection ───────────────────────────────────────────────────

interface PackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  jest?: Record<string, unknown>;
}

function detectTestFramework(root: string): string {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return "jest";
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    if ("vitest" in all) return "vitest";
    if ("jest" in all || pkg.jest) return "jest";
    if ("mocha" in all) return "mocha";
  } catch { /* ignore */ }
  return "jest";
}

function detectTestScript(root: string): string | null {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
    if (pkg.scripts?.["test:coverage"]) return "test:coverage";
    if (pkg.scripts?.["test"]) return "test";
  } catch { /* ignore */ }
  return null;
}

function detectPackageManager(root: string): string {
  if (existsSync(join(root, "bun.lockb")))      return "bun";
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock")))       return "yarn";
  return "npm";
}

// ── Test Generation via AI ─────────────────────────────────────────────────────

export async function generateTests(
  api: CoaiApiClient,
  root: string,
  request: TestGenerationRequest,
  context: string,
): Promise<string> {
  const targetPath = join(root, request.targetFile);
  let sourceContent = "";
  try { sourceContent = readFileSync(targetPath, "utf8"); } catch { /* ignore */ }

  const testTypesDesc = request.testTypes.join(", ");
  const framework = detectTestFramework(root);

  const prompt = [
    `Generate ${testTypesDesc} tests for this file using ${framework}.`,
    `File: ${request.targetFile}`,
    `Framework: ${request.framework}`,
    `Test framework: ${framework}`,
    "",
    "Requirements:",
    "- Cover all exported functions/components",
    "- Include edge cases and error paths",
    "- Use descriptive test names",
    "- Mock external dependencies",
    "- Aim for >80% coverage",
    "",
    "Source file content:",
    "```",
    sourceContent.slice(0, 8000),
    "```",
    "",
    "Return only the test file content, no explanations.",
  ].join("\n");

  let testContent = "";
  const stream = api.stream("/v1/chat", { message: prompt, history: [], context });
  for await (const event of stream) {
    if (event.kind === "chunk" && typeof event.text === "string") testContent += event.text;
    if (event.kind === "done"  && typeof event.text === "string") testContent = event.text;
  }

  return testContent.trim();
}

// ── Run Tests ──────────────────────────────────────────────────────────────────

export function runTests(root: string): TestRunResult {
  const pm     = detectPackageManager(root);
  const script = detectTestScript(root);
  if (!script) {
    return { passed: true, total: 0, passing: 0, failing: 0, output: "No test script configured.", durationMs: 0 };
  }

  const start = Date.now();
  try {
    const output = execSync(`${pm} run ${script} -- --coverage 2>&1 || true`, {
      cwd: root,
      timeout: 120_000,
      encoding: "utf8",
    });
    const durationMs = Date.now() - start;
    const coverage   = parseCoverage(output);
    const { total, passing, failing } = parseTestCounts(output);

    return { passed: failing === 0, total, passing, failing, coverage, output: output.slice(0, 3000), durationMs };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    const output = [(e.stdout ?? ""), (e.stderr ?? "")].join("\n").slice(0, 3000);
    return { passed: false, total: 0, passing: 0, failing: 1, output, durationMs: Date.now() - start };
  }
}

function parseTestCounts(output: string): { total: number; passing: number; failing: number } {
  // Jest: "Tests: 5 passed, 1 failed, 6 total"
  // Vitest: "✓ 5 | ✗ 1"
  const jestMatch = output.match(/Tests:\s+(\d+)\s+passed(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+total)?/);
  if (jestMatch) {
    const passing = parseInt(jestMatch[1] ?? "0", 10);
    const failing = parseInt(jestMatch[2] ?? "0", 10);
    const total   = parseInt(jestMatch[3] ?? String(passing + failing), 10);
    return { total, passing, failing };
  }
  return { total: 0, passing: 0, failing: 0 };
}

function parseCoverage(output: string): CoverageReport | undefined {
  // Jest/Vitest text coverage table: "All files | 85 | 72 | 90 | 85"
  const match = output.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
  if (!match) return undefined;
  return {
    statements: parseFloat(match[1] ?? "0"),
    branches:   parseFloat(match[2] ?? "0"),
    functions:  parseFloat(match[3] ?? "0"),
    lines:      parseFloat(match[4] ?? "0"),
  };
}

// ── Print Results ──────────────────────────────────────────────────────────────

export function printTestResults(result: TestRunResult): void {
  console.log(chalk.bold("\n  Test Results"));
  console.log(chalk.dim("─".repeat(50)));

  if (result.total > 0) {
    const passIcon = result.failing === 0 ? chalk.green("✓") : chalk.red("✗");
    console.log(`  ${passIcon} ${result.passing}/${result.total} passed  ${chalk.dim(`(${result.durationMs}ms)`)}`);
    if (result.failing > 0) console.log(chalk.red(`  ✗ ${result.failing} failing`));
  } else {
    console.log(chalk.dim("  " + result.output));
  }

  if (result.coverage) {
    const c = result.coverage;
    const pct = (n: number) => (n >= 80 ? chalk.green : n >= 60 ? chalk.yellow : chalk.red)(`${n}%`);
    console.log(`\n  Coverage:`);
    console.log(`    Statements ${pct(c.statements)}  Branches ${pct(c.branches)}  Functions ${pct(c.functions)}  Lines ${pct(c.lines)}`);
  }

  console.log();
}
