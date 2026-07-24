// runner.ts — executes every hermetic test file referenced by registry.ts
// exactly once per project, merges V8 coverage across all of them via c8's
// report-only mode, and hands raw per-file outcomes back to scorer.ts.
//
// Hermetic by construction: NODE_ENV=test (tmap-v2's src/config.ts
// forceOfflineForTest() short-circuits every provider to mock on this),
// COAGENTIX_ALLOW_LIVE is stripped, and a pre-flight guard refuses to run at
// all if any *_API_KEY is present in the environment or COAGENTIX_ALLOW_LIVE
// is set — this engine must never make a real network/provider call.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Project } from "./registry.ts";
import type { TestFileOutcome } from "./types.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
export const PROJECT_ROOT: Record<Project, string> = {
  "aof-web": path.join(REPO_ROOT, "aof-web"),
  "tmap-v2": path.join(REPO_ROOT, "tmap-v2"),
};

const PER_FILE_TIMEOUT_MS = 60_000;

/** tsx's own CLI entry inside a project's node_modules — invoked via `node` directly so no shell/.cmd resolution is needed on Windows. */
function tsxCli(root: string): string {
  return path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
}

/** c8's own CLI entry inside this engine's node_modules — same direct-`node` invocation, no shell needed. */
const C8_CLI = path.join(REPO_ROOT, "validation-engine", "node_modules", "c8", "bin", "c8.js");

export function assertHermetic(): void {
  if (process.env.COAGENTIX_ALLOW_LIVE) {
    throw new Error(
      "Hermetic guard: COAGENTIX_ALLOW_LIVE is set in the environment — refusing to run the validation engine live.",
    );
  }
  const leakedKeys = Object.keys(process.env).filter((k) => /_API_KEY$/.test(k));
  if (leakedKeys.length) {
    throw new Error(
      `Hermetic guard: provider API key(s) present in the environment (${leakedKeys.join(", ")}) — ` +
        `refusing to run, since these would make hermetic tests reachable to real providers. Unset them first.`,
    );
  }
}

function hermeticEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  env.NODE_ENV = "test";
  delete env.COAGENTIX_ALLOW_LIVE;
  for (const k of Object.keys(env)) {
    if (/_API_KEY$/.test(k)) delete env[k];
  }
  return env;
}

// TAP's `ok N - <name>` / `not ok N - <name>` lines, at any indent level —
// both suite and test entries match; scorer.ts's category-keyword search
// treats the union as a corpus, so over-matching suite names is harmless.
const TAP_LINE = /^\s*(ok|not ok)\s+\d+\s*(?:-\s*(.*))?$/;
const TAP_SUMMARY_PASS = /^# pass (\d+)/m;
const TAP_SUMMARY_FAIL = /^# fail (\d+)/m;

function parseTap(stdout: string): { pass: number; fail: number; testNames: string[]; failedNames: string[] } {
  const passMatch = stdout.match(TAP_SUMMARY_PASS);
  const failMatch = stdout.match(TAP_SUMMARY_FAIL);
  const testNames: string[] = [];
  const failedNames: string[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(TAP_LINE);
    if (!m) continue;
    const name = (m[2] ?? "").trim();
    if (name) testNames.push(name);
    if (m[1] === "not ok" && name) failedNames.push(name);
  }
  return {
    pass: passMatch ? Number(passMatch[1]) : 0,
    fail: failMatch ? Number(failMatch[1]) : 0,
    testNames,
    failedNames,
  };
}

function runOneFile(project: Project, relFile: string, v8CoverageDir: string): TestFileOutcome {
  const root = PROJECT_ROOT[project];
  const absFile = path.join(root, relFile);
  if (!existsSync(absFile)) {
    return { file: relFile, exists: false, pass: 0, fail: 0, failedNames: [], testNames: [], ranMs: 0, crashed: false };
  }

  const env = hermeticEnv();
  env.NODE_V8_COVERAGE = v8CoverageDir;

  const start = Date.now();
  const result = spawnSync(process.execPath, [tsxCli(root), "--test", "--test-reporter=tap", relFile], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: PER_FILE_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  });
  const ranMs = Date.now() - start;

  if (result.error || result.signal) {
    return {
      file: relFile,
      exists: true,
      pass: 0,
      fail: 0,
      failedNames: [],
      testNames: [],
      ranMs,
      crashed: true,
      crashMessage: result.error ? String(result.error.message) : `killed by signal ${result.signal}`,
    };
  }

  const stdout = result.stdout ?? "";
  const parsed = parseTap(stdout);
  // A nonzero exit with a parsed pass/fail summary of 0/0 means the process
  // crashed before node:test even ran (e.g. a top-level import throw) —
  // report that honestly as a crash, not a silent 0-test "pass".
  const crashedBeforeTests = result.status !== 0 && parsed.pass === 0 && parsed.fail === 0;

  return {
    file: relFile,
    exists: true,
    pass: parsed.pass,
    fail: parsed.fail,
    failedNames: parsed.failedNames,
    testNames: parsed.testNames,
    ranMs,
    crashed: crashedBeforeTests,
    crashMessage: crashedBeforeTests ? (result.stderr || "non-zero exit with no parsed TAP summary").slice(0, 2000) : undefined,
  };
}

export interface ProjectRun {
  testFiles: Map<string, TestFileOutcome>; // key: relative file path
  coveragePct: Map<string, number>; // key: absolute source file path -> lines.pct
}

function mergeCoverage(root: string, v8CoverageDir: string): Map<string, number> {
  const outDir = mkdtempSync(path.join(tmpdir(), "validation-engine-cov-out-"));
  const result = spawnSync(
    process.execPath,
    [C8_CLI, "report", "--temp-directory", v8CoverageDir, "--report-dir", outDir, "--reporter=json-summary"],
    { cwd: root, encoding: "utf8", timeout: 60_000 },
  );
  const summaryPath = path.join(outDir, "coverage-summary.json");
  const map = new Map<string, number>();
  if (!existsSync(summaryPath)) {
    return map; // no files were ever imported by the suite — legitimate 0-coverage signal, not an error
  }
  try {
    const raw = JSON.parse(readFileSync(summaryPath, "utf8")) as Record<string, { lines: { pct: number } }>;
    for (const [file, data] of Object.entries(raw)) {
      if (file === "total") continue;
      map.set(file, data.lines.pct);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
  return map;
}

/** Runs every unique test file in `files` for one project exactly once, merges coverage across all of them. */
export function runProject(project: Project, files: string[]): ProjectRun {
  const root = PROJECT_ROOT[project];
  const v8CoverageDir = mkdtempSync(path.join(tmpdir(), `validation-engine-cov-${project}-`));
  mkdirSync(v8CoverageDir, { recursive: true });

  const testFiles = new Map<string, TestFileOutcome>();
  const unique = Array.from(new Set(files));
  for (const relFile of unique) {
    testFiles.set(relFile, runOneFile(project, relFile, v8CoverageDir));
  }

  const coveragePct = mergeCoverage(root, v8CoverageDir);
  rmSync(v8CoverageDir, { recursive: true, force: true });

  return { testFiles, coveragePct };
}

export function resolveSourceCoverage(
  project: Project,
  sourceFile: string,
  coveragePct: Map<string, number>,
): number | null {
  const abs = path.join(PROJECT_ROOT[project], sourceFile);
  return coveragePct.has(abs) ? coveragePct.get(abs)! : null;
}
