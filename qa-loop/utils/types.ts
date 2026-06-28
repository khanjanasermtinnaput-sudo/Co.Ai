export interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  details?: Record<string, unknown>;
  screenshot?: string;
  request?: { url: string; method: string; body?: string };
  response?: { status: number; body?: string; headers?: Record<string, string> };
  rootCause?: string;
  suggestedFix?: string;
}

export interface PhaseResult {
  phase: number;
  name: string;
  tests: TestResult[];
  totalMs: number;
  passCount: number;
  failCount: number;
  skipped?: boolean;
  skipReason?: string;
}

export interface RunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  phases: PhaseResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    criticalBugs: CriticalBug[];
    warnings: string[];
    performanceMs: Record<string, number>;
    memoryUsageMb: number;
    recommendations: string[];
  };
}

export interface CriticalBug {
  phase: number;
  phaseName: string;
  test: string;
  error: string;
  rootCause?: string;
  suggestedFix?: string;
  screenshot?: string;
}
