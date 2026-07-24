// types.ts — shared shapes passed between runner.ts -> scorer.ts -> report.ts.

export interface TestFileOutcome {
  file: string; // relative to project root
  exists: boolean;
  pass: number;
  fail: number;
  failedNames: string[];
  testNames: string[]; // raw ok/not-ok line names — corpus for category-keyword detection
  ranMs: number;
  crashed: boolean; // the spawn itself errored/timed out, distinct from in-suite test failures
  crashMessage?: string;
}

export interface ComponentResult {
  name: string;
  meta: boolean;
  notImplemented: boolean;
  note?: string;
  pass: number;
  fail: number;
  crashedFiles: string[];
  failedTests: string[];
  filesRun: string[];
  filesMissing: string[];
  coveragePct: number | null;
  requiredCategories: string[];
  missingCategories: string[];
  categoryCompleteness: number; // 0..1
  score: number; // 0..10
}

export interface RunResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  hermetic: true;
  components: ComponentResult[];
  overallScore: number;
  overallCoveragePct: number;
  criticalFailures: number; // components with fail>0 or crashedFiles.length>0, excluding meta/notImplemented
  targetCoverage: number;
  targetScore: number;
  thresholdsMet: boolean;
}
