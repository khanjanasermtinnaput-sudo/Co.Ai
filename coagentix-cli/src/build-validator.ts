// Build Validation Engine: run build/lint/test after changes, auto-rollback on failure

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";

export interface BuildResult {
  step: "build" | "lint" | "test" | "typecheck";
  passed: boolean;
  output: string;
  durationMs: number;
}

export interface ValidationReport {
  passed: boolean;
  results: BuildResult[];
  summary: string;
}

interface PackageJson {
  scripts?: Record<string, string>;
}

function detectScripts(root: string): Record<string, boolean> {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
    return {
      build:     Boolean(pkg.scripts?.["build"]),
      lint:      Boolean(pkg.scripts?.["lint"]),
      test:      Boolean(pkg.scripts?.["test"]),
      typecheck: Boolean(pkg.scripts?.["typecheck"] ?? pkg.scripts?.["type-check"] ?? pkg.scripts?.["tsc"]),
    };
  } catch {
    return {};
  }
}

function detectPackageManager(root: string): "npm" | "yarn" | "pnpm" | "bun" {
  if (existsSync(join(root, "bun.lockb")))       return "bun";
  if (existsSync(join(root, "pnpm-lock.yaml")))  return "pnpm";
  if (existsSync(join(root, "yarn.lock")))        return "yarn";
  return "npm";
}

function runScript(root: string, pm: string, script: string): BuildResult {
  const step = script.replace("type-check", "typecheck").replace("tsc", "typecheck") as BuildResult["step"];
  const start = Date.now();
  try {
    const output = execSync(`${pm} run ${script}`, {
      cwd: root,
      timeout: 120_000,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { step, passed: true, output: output.slice(0, 2000), durationMs: Date.now() - start };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = [(e.stdout ?? ""), (e.stderr ?? ""), (e.message ?? "")].join("\n").slice(0, 2000);
    return { step, passed: false, output, durationMs: Date.now() - start };
  }
}

export async function runBuildValidation(root: string): Promise<ValidationReport> {
  const scripts = detectScripts(root);
  const pm      = detectPackageManager(root);
  const results: BuildResult[] = [];

  // Run in order: typecheck → build → lint → test
  const steps: Array<[keyof typeof scripts, string]> = [
    ["typecheck", "typecheck"],
    ["build",     "build"],
    ["lint",      "lint"],
    ["test",      "test"],
  ];

  for (const [key, script] of steps) {
    if (!scripts[key]) continue;
    const result = runScript(root, pm, script);
    results.push(result);
    if (!result.passed) break; // stop on first failure
  }

  const failed = results.filter((r) => !r.passed);
  const passed = failed.length === 0;

  const lines: string[] = [];
  for (const r of results) {
    const icon = r.passed ? chalk.green("✓") : chalk.red("✗");
    lines.push(`${icon} ${r.step.padEnd(10)} ${r.durationMs}ms`);
    if (!r.passed && r.output) {
      lines.push(chalk.dim(r.output.split("\n").slice(0, 10).join("\n")));
    }
  }

  if (results.length === 0) {
    lines.push(chalk.dim("No build/lint/test scripts detected — skipping validation."));
  }

  return {
    passed,
    results,
    summary: lines.join("\n"),
  };
}

export function printValidationReport(report: ValidationReport): void {
  console.log(chalk.bold("\n  Build Validation"));
  console.log(chalk.dim("─".repeat(50)));
  console.log(report.summary);
  if (report.passed) {
    console.log(chalk.green("\n  All checks passed."));
  } else {
    const failed = report.results.filter((r) => !r.passed).map((r) => r.step);
    console.log(chalk.red(`\n  Failed: ${failed.join(", ")}`));
  }
}
