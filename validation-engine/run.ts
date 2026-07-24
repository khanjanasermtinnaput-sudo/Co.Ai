#!/usr/bin/env node
// run.ts — CLI entry point.
//
// Usage:
//   npx tsx run.ts --once                 # single bounded pass (used by CI)
//   npx tsx run.ts                        # continuous-until-threshold loop, bounded by hard caps
//   npx tsx run.ts --report-only          # re-print the most recently written scorecard, runs nothing
//
// Flags (all optional):
//   --target-coverage <n>   default 90   (99 is the spec's aspirational target; kept configurable)
//   --target-score <n>      default 9.5
//   --max-iterations <n>    default 3 (forced to 1 by --once)
//   --wall-clock <dur>      default 15m  (accepts "900", "900s", "15m", "1h")

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runLoop } from "./loop.ts";
import { printConsole, writeReport } from "./report.ts";
import type { RunResult } from "./types.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const REPORTS_DIR = path.join(import.meta.dirname, "reports");

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseDuration(s: string): number {
  const m = s.match(/^(\d+(?:\.\d+)?)(s|m|h)?$/);
  if (!m) throw new Error(`invalid --wall-clock value: ${s}`);
  const n = Number(m[1]);
  const unit = m[2] ?? "s";
  const mult = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1000;
  return n * mult;
}

async function reportOnly(): Promise<void> {
  if (!existsSync(REPORTS_DIR)) {
    console.log("No runs found — run `npm run once` first.");
    process.exitCode = 1;
    return;
  }
  const dirs = readdirSync(REPORTS_DIR)
    .filter((d) => d.startsWith("run-"))
    .map((d) => ({ d, mtime: statSync(path.join(REPORTS_DIR, d)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!dirs.length) {
    console.log("No runs found — run `npm run once` first.");
    process.exitCode = 1;
    return;
  }
  const latest = path.join(REPORTS_DIR, dirs[0].d, "scorecard.json");
  const run: RunResult = JSON.parse(readFileSync(latest, "utf8"));
  printConsole(run);
  console.log(`(re-printed from ${latest})`);
  process.exitCode = run.thresholdsMet ? 0 : 1;
}

async function main(): Promise<void> {
  if (hasFlag("report-only")) {
    await reportOnly();
    return;
  }

  const once = hasFlag("once");
  const opts = {
    targetCoverage: Number(flag("target-coverage") ?? 90),
    targetScore: Number(flag("target-score") ?? 9.5),
    maxIterations: once ? 1 : Number(flag("max-iterations") ?? 3),
    wallClockCapMs: parseDuration(flag("wall-clock") ?? "15m"),
  };

  console.log(`Co.AI Validation Loop — repo: ${REPO_ROOT}`);
  console.log(`Mode: ${once ? "single pass (--once)" : "continuous-until-threshold"} | target score >= ${opts.targetScore}, coverage >= ${opts.targetCoverage}%`);

  const loopResult = await runLoop(opts, (run) => {
    console.log(
      `  iteration done: score=${run.overallScore.toFixed(2)} coverage=${run.overallCoveragePct.toFixed(1)}% ` +
        `criticalFailures=${run.criticalFailures} thresholdsMet=${run.thresholdsMet}`,
    );
  });

  const dir = writeReport(loopResult.finalRun, REPORTS_DIR);
  printConsole(loopResult.finalRun);

  console.log(`Iterations run: ${loopResult.iterations.length} | stopped: ${loopResult.stoppedReason}`);
  if (loopResult.flakyFiles.length) {
    console.log(`Flaky files (pass/fail differed across iterations): ${loopResult.flakyFiles.join(", ")}`);
  } else if (loopResult.iterations.length > 1) {
    console.log(`No flaky files detected across ${loopResult.iterations.length} iterations.`);
  }

  const loopSummaryPath = path.join(dir, "loop-summary.json");
  writeFileSync(
    loopSummaryPath,
    JSON.stringify({ iterations: loopResult.iterations, flakyFiles: loopResult.flakyFiles, stoppedReason: loopResult.stoppedReason }, null, 2),
    "utf8",
  );
  console.log(`\nReport written to: ${dir}`);

  process.exitCode = loopResult.finalRun.thresholdsMet ? 0 : 1;
}

main().catch((err) => {
  console.error("Validation engine failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
