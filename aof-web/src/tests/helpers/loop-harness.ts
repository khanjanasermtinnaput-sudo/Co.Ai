// ── Loop test harness ─────────────────────────────────────────────────────────
// Generic reliability-loop primitive for full-system-loop.test.ts. Not itself a
// node:test file (no test() calls) — a plain module full-system-loop.test.ts
// imports from. Runs a check function up to N times, isolates each iteration's
// failure so one bad run never aborts the suite, and classifies the aggregate.

export type IterationOutcome =
  | { status: "pass"; latencyMs: number }
  | { status: "fail"; latencyMs: number; error: string };

export interface LoopResult {
  name: string;
  iterations: number;
  attempted: number;
  passed: number;
  failed: number;
  skipped: boolean;
  skipReason?: string;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  outcomes: IterationOutcome[];
  classification: "reliable" | "flaky" | "failing" | "skipped";
  firstError?: string;
}

export interface LoopOptions {
  /** Number of iterations to run. Default 10. */
  iterations?: number;
  /** Checked ONCE before the loop starts (not per-iteration). Return a reason
   *  string to skip the whole case (e.g. a missing env var), or undefined to
   *  proceed normally. */
  skipIf?: () => string | undefined;
}

function classify(passed: number, attempted: number): LoopResult["classification"] {
  if (attempted === 0) return "skipped";
  if (passed >= 8 * (attempted / 10)) return "reliable";
  if (passed >= 6 * (attempted / 10)) return "flaky";
  return "failing";
}

export async function runLoop(
  name: string,
  fn: (iteration: number) => Promise<void>,
  opts: LoopOptions = {},
): Promise<LoopResult> {
  const iterations = opts.iterations ?? 10;
  const skipReason = opts.skipIf?.();
  if (skipReason) {
    return {
      name,
      iterations,
      attempted: 0,
      passed: 0,
      failed: 0,
      skipped: true,
      skipReason,
      avgLatencyMs: null,
      p95LatencyMs: null,
      outcomes: [],
      classification: "skipped",
    };
  }

  const outcomes: IterationOutcome[] = [];
  for (let i = 0; i < iterations; i++) {
    const started = Date.now();
    try {
      await fn(i);
      outcomes.push({ status: "pass", latencyMs: Date.now() - started });
    } catch (err) {
      outcomes.push({
        status: "fail",
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const passed = outcomes.filter((o) => o.status === "pass").length;
  const failed = outcomes.filter((o) => o.status === "fail").length;
  const latencies = outcomes.map((o) => o.latencyMs).sort((a, b) => a - b);
  const avgLatencyMs = latencies.length
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : null;
  const p95Index = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
  const p95LatencyMs = latencies.length ? latencies[p95Index] : null;
  const firstError = outcomes.find((o): o is Extract<IterationOutcome, { status: "fail" }> =>
    o.status === "fail",
  )?.error;

  return {
    name,
    iterations,
    attempted: iterations,
    passed,
    failed,
    skipped: false,
    avgLatencyMs,
    p95LatencyMs,
    outcomes,
    classification: classify(passed, iterations),
    firstError,
  };
}

/** Single-shot variant for non-idempotent / quota-limited / side-effecting
 *  checks (shared daily quotas, live external network calls) where looping 10x
 *  would exhaust a real shared budget rather than measure reliability. Reuses
 *  runLoop's internals (iterations: 1) so the result shape and table rendering
 *  are identical either way. */
export function runOnce(name: string, fn: () => Promise<void>): Promise<LoopResult> {
  return runLoop(name, () => fn(), { iterations: 1 });
}

export function printSubsystemTable(subsystem: string, results: LoopResult[]): void {
  console.log(`\n=== ${subsystem} ===`);
  console.table(
    results
      .filter((r) => !r.skipped)
      .map((r) => ({
        Test: r.name,
        "Pass/Attempted": `${r.passed}/${r.attempted}`,
        "Avg ms": r.avgLatencyMs != null ? r.avgLatencyMs.toFixed(0) : "-",
        "P95 ms": r.p95LatencyMs != null ? r.p95LatencyMs.toFixed(0) : "-",
        Status: r.classification.toUpperCase(),
      })),
  );

  const skipped = results.filter((r) => r.skipped);
  if (skipped.length) {
    console.log(`Skipped (${skipped.length}):`);
    console.table(skipped.map((r) => ({ Test: r.name, Reason: r.skipReason ?? "(no reason given)" })));
  }
}

export function printFinalScore(allResults: LoopResult[]): void {
  const nonSkipped = allResults.filter((r) => !r.skipped);
  const reliable = nonSkipped.filter((r) => r.classification === "reliable").length;
  const flaky = nonSkipped.filter((r) => r.classification === "flaky").length;
  const failing = nonSkipped.filter((r) => r.classification === "failing").length;
  const skippedCount = allResults.length - nonSkipped.length;
  const score = nonSkipped.length ? (reliable / nonSkipped.length) * 10 : 0;

  console.log(`\n=== FINAL SCORE ===`);
  console.log(`Total test cases attempted: ${nonSkipped.length} (reliable: ${reliable}, flaky: ${flaky}, failing: ${failing})`);
  console.log(`Skipped (excluded from score): ${skippedCount}`);
  console.log(`Formula: (reliable / attempted) × 10 = (${reliable}/${nonSkipped.length}) × 10`);
  console.log(`SCORE: ${score.toFixed(1)} / 10`);

  if (failing > 0 || flaky > 0) {
    console.log(`\nNon-reliable test cases:`);
    console.table(
      nonSkipped
        .filter((r) => r.classification !== "reliable")
        .map((r) => ({
          Test: r.name,
          "Pass/Attempted": `${r.passed}/${r.attempted}`,
          Status: r.classification.toUpperCase(),
          "First error": r.firstError ?? "-",
        })),
    );
  }
}
