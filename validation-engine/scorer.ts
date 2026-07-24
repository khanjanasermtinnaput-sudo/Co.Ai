// scorer.ts — turns raw runner.ts output into the per-component and overall
// 0-10 scorecard. Deliberately NOT coverage-weighted for the overall mean:
// a coverage-weighted mean would give an unimplemented component (0%
// coverage) near-zero WEIGHT, letting it barely move the overall score —
// the opposite of the honesty this is supposed to enforce. Every non-meta
// component counts equally toward "overall."

import { existsSync } from "node:fs";
import path from "node:path";
import { COMPONENTS, type Category } from "./registry.ts";
import { PROJECT_ROOT, resolveSourceCoverage, type ProjectRun } from "./runner.ts";
import type { ComponentResult, RunResult } from "./types.ts";

const CATEGORY_KEYWORDS: Record<Category, RegExp> = {
  // "normal" has no literal keyword — evidenced by the mere existence of a
  // passing test at all, checked separately below rather than by regex.
  normal: /(?!)x/,
  boundary: /boundary|limit|cap(s|ped)?\b|threshold|min(imum)?\b|max(imum)?\b/i,
  edge: /edge case|corner case|empty (string|array|object)|zero-length|huge|extreme/i,
  invalid: /invalid|malformed|garbage|bad input|nonsense|junk/i,
  failure: /\bfail(s|ed|ure)?\b|\berror\b|crash|throw(s|n)?\b|reject|timeout/i,
  recovery: /recover(s|y)?|retry|retries|degrade|fallback|resume|restart/i,
  security: /security|inject|redact|leak|auth(entication)?\b|permission|sanitiz/i,
};

function categoryCompleteness(required: Category[], corpus: string[]): { completeness: number; missing: Category[] } {
  if (required.length === 0) return { completeness: 1, missing: [] };
  const missing: Category[] = [];
  for (const cat of required) {
    if (cat === "normal") {
      if (corpus.length === 0) missing.push(cat);
      continue;
    }
    const re = CATEGORY_KEYWORDS[cat];
    if (!corpus.some((name) => re.test(name))) missing.push(cat);
  }
  return { completeness: (required.length - missing.length) / required.length, missing };
}

function scoreOf(passRate: number, coveragePct: number, targetCoverage: number, catCompleteness: number): number {
  const coverageTerm = Math.min(coveragePct / targetCoverage, 1);
  return 10 * (0.5 * passRate + 0.35 * coverageTerm + 0.15 * catCompleteness);
}

export interface ScoreOptions {
  targetCoverage: number;
  targetScore: number;
}

export function score(runs: Record<"aof-web" | "tmap-v2", ProjectRun>, opts: ScoreOptions): RunResult {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const components: ComponentResult[] = [];

  for (const entry of COMPONENTS) {
    if (entry.meta) {
      // filled in below, after every real component has a score
      components.push({
        name: entry.name,
        meta: true,
        notImplemented: false,
        note: entry.note,
        pass: 0,
        fail: 0,
        crashedFiles: [],
        failedTests: [],
        filesRun: [],
        filesMissing: [],
        coveragePct: null,
        requiredCategories: [],
        missingCategories: [],
        categoryCompleteness: 1,
        score: 0,
      });
      continue;
    }
    if (entry.notImplemented) {
      components.push({
        name: entry.name,
        meta: false,
        notImplemented: true,
        note: entry.note,
        pass: 0,
        fail: 0,
        crashedFiles: [],
        failedTests: [],
        filesRun: [],
        filesMissing: [],
        coveragePct: 0,
        requiredCategories: [],
        missingCategories: [],
        categoryCompleteness: 0,
        score: 0,
      });
      continue;
    }

    let pass = 0;
    let fail = 0;
    const crashedFiles: string[] = [];
    const failedTests: string[] = [];
    const filesRun: string[] = [];
    const filesMissing: string[] = [];
    const corpus: string[] = [];
    const coverages: number[] = [];

    for (const target of entry.targets) {
      const run = runs[target.project];
      for (const relFile of target.testFiles) {
        const outcome = run.testFiles.get(relFile);
        if (!outcome || !outcome.exists) {
          filesMissing.push(`${target.project}/${relFile}`);
          continue;
        }
        filesRun.push(`${target.project}/${relFile}`);
        if (outcome.crashed) {
          crashedFiles.push(`${target.project}/${relFile}${outcome.crashMessage ? `: ${outcome.crashMessage}` : ""}`);
          continue;
        }
        pass += outcome.pass;
        fail += outcome.fail;
        failedTests.push(...outcome.failedNames.map((n) => `${target.project}/${relFile} :: ${n}`));
        corpus.push(...outcome.testNames);
      }
      for (const relSource of target.sourceFiles) {
        const abs = path.join(PROJECT_ROOT[target.project], relSource);
        if (!existsSync(abs)) {
          filesMissing.push(`${target.project}/${relSource} (source file referenced by registry.ts does not exist)`);
          continue;
        }
        const pct = resolveSourceCoverage(target.project, relSource, run.coveragePct);
        coverages.push(pct ?? 0);
      }
    }

    const crashPenalty = crashedFiles.length;
    const denom = pass + fail + crashPenalty;
    const passRate = denom > 0 ? pass / denom : 0;
    const coveragePct = coverages.length > 0 ? coverages.reduce((a, b) => a + b, 0) / coverages.length : 0;
    const { completeness, missing } = categoryCompleteness(entry.requiredCategories, corpus);
    const s = scoreOf(passRate, coveragePct, opts.targetCoverage, completeness);

    components.push({
      name: entry.name,
      meta: false,
      notImplemented: false,
      note: entry.note,
      pass,
      fail,
      crashedFiles,
      failedTests,
      filesRun,
      filesMissing,
      coveragePct,
      requiredCategories: entry.requiredCategories,
      missingCategories: missing,
      categoryCompleteness: completeness,
      score: s,
    });
  }

  const scored = components.filter((c) => !c.meta);
  const overallScore = scored.length ? scored.reduce((a, c) => a + c.score, 0) / scored.length : 0;
  const overallCoveragePct = scored.length ? scored.reduce((a, c) => a + (c.coveragePct ?? 0), 0) / scored.length : 0;
  const criticalFailures = scored.filter((c) => !c.notImplemented && (c.fail > 0 || c.crashedFiles.length > 0)).length;

  for (const c of components) {
    if (c.meta) {
      c.score = overallScore;
      c.coveragePct = overallCoveragePct;
    }
  }

  const thresholdsMet = overallCoveragePct >= opts.targetCoverage && overallScore >= opts.targetScore && criticalFailures === 0;

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    hermetic: true,
    components,
    overallScore,
    overallCoveragePct,
    criticalFailures,
    targetCoverage: opts.targetCoverage,
    targetScore: opts.targetScore,
    thresholdsMet,
  };
}
