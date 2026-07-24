// loop.ts — continuous-until-threshold driver, bounded by hard caps.
//
// A hermetic, deterministic suite converges on the first pass: re-running
// identical tests can't raise the score by itself. So the loop's real jobs
// are (a) flake detection across iterations and (b) staying a safe, bounded
// re-run driver rather than a literal infinite loop. It always terminates on
// thresholdsMet OR maxIterations OR wallClockCap — never truly unbounded.

import { COMPONENTS, type Project } from "./registry.ts";
import { assertHermetic, runProject } from "./runner.ts";
import { score, type ScoreOptions } from "./scorer.ts";
import type { RunResult } from "./types.ts";

function collectFiles(project: Project): string[] {
  const files = new Set<string>();
  for (const entry of COMPONENTS) {
    if (entry.meta || entry.notImplemented) continue;
    for (const target of entry.targets) {
      if (target.project !== project) continue;
      for (const f of target.testFiles) files.add(f);
    }
  }
  return Array.from(files);
}

export interface LoopOptions extends ScoreOptions {
  maxIterations: number;
  wallClockCapMs: number;
}

export interface IterationSummary {
  iteration: number;
  startedAt: string;
  durationMs: number;
  overallScore: number;
  overallCoveragePct: number;
  criticalFailures: number;
  thresholdsMet: boolean;
}

export interface LoopResult {
  finalRun: RunResult;
  iterations: IterationSummary[];
  flakyFiles: string[];
  stoppedReason: "thresholds-met" | "max-iterations" | "wall-clock-cap";
}

/** A test file is flaky if its fail/crashed status differs across iterations. */
function detectFlakes(perIterationOutcomes: Array<Map<string, boolean>>): string[] {
  const allFiles = new Set<string>();
  for (const m of perIterationOutcomes) for (const f of m.keys()) allFiles.add(f);
  const flaky: string[] = [];
  for (const f of allFiles) {
    const states = perIterationOutcomes.map((m) => m.get(f)).filter((v) => v !== undefined);
    if (new Set(states).size > 1) flaky.push(f);
  }
  return flaky;
}

export async function runLoop(opts: LoopOptions, onIteration?: (run: RunResult) => void): Promise<LoopResult> {
  assertHermetic();

  const aofFiles = collectFiles("aof-web");
  const tmapFiles = collectFiles("tmap-v2");

  const iterations: IterationSummary[] = [];
  const perIterationOutcomes: Array<Map<string, boolean>> = [];
  let finalRun: RunResult | undefined;
  const loopStart = Date.now();
  let stoppedReason: LoopResult["stoppedReason"] = "max-iterations";

  for (let i = 1; i <= opts.maxIterations; i++) {
    const iterStart = Date.now();
    const aofRun = runProject("aof-web", aofFiles);
    const tmapRun = runProject("tmap-v2", tmapFiles);
    const result = score({ "aof-web": aofRun, "tmap-v2": tmapRun }, opts);
    // score()'s own durationMs only times the scoring arithmetic (sub-ms) —
    // overwrite it with the real wall-clock time of running every test file.
    result.durationMs = Date.now() - iterStart;
    finalRun = result;
    onIteration?.(result);

    const failMap = new Map<string, boolean>();
    for (const [file, outcome] of aofRun.testFiles) failMap.set(`aof-web/${file}`, outcome.fail > 0 || outcome.crashed);
    for (const [file, outcome] of tmapRun.testFiles) failMap.set(`tmap-v2/${file}`, outcome.fail > 0 || outcome.crashed);
    perIterationOutcomes.push(failMap);

    iterations.push({
      iteration: i,
      startedAt: result.startedAt,
      durationMs: Date.now() - iterStart,
      overallScore: result.overallScore,
      overallCoveragePct: result.overallCoveragePct,
      criticalFailures: result.criticalFailures,
      thresholdsMet: result.thresholdsMet,
    });

    if (result.thresholdsMet) {
      stoppedReason = "thresholds-met";
      break;
    }
    if (Date.now() - loopStart >= opts.wallClockCapMs) {
      stoppedReason = "wall-clock-cap";
      break;
    }
    if (i >= opts.maxIterations) {
      stoppedReason = "max-iterations";
      break;
    }
  }

  return {
    finalRun: finalRun!,
    iterations,
    flakyFiles: detectFlakes(perIterationOutcomes),
    stoppedReason,
  };
}
