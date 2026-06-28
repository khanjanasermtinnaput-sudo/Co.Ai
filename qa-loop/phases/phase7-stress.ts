import { loadBurst } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

// Concurrency tiers. Capped at config.maxStressUsers (default 100).
const TIERS = [10, 50, 100, 500, 1000] as const;

export async function runPhase7(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  const activeTiers = TIERS.filter((t) => t <= config.maxStressUsers);
  const endpoints = [
    { label: "frontend /api/health", url: `${config.baseUrl}/api/health` },
    { label: "backend /v1/health", url: `${config.backendUrl}/v1/health` },
  ];

  for (const endpoint of endpoints) {
    for (const concurrency of activeTiers) {
      const t0 = Date.now();
      log.info(`Stress: ${concurrency} concurrent → ${endpoint.label}`);

      const result = await loadBurst(endpoint.url, concurrency, config.timeoutMs);

      const acceptable =
        result.successRate >= 0.95 && // ≥95% success
        result.p95 < 8000; // p95 < 8 s

      const t: TestResult = {
        name: `Stress [${concurrency} users] → ${endpoint.label}`,
        passed: acceptable,
        durationMs: Date.now() - t0,
        details: {
          concurrency,
          p50: result.p50 + "ms",
          p95: result.p95 + "ms",
          p99: result.p99 + "ms",
          successRate: (result.successRate * 100).toFixed(1) + "%",
          rps: result.rps,
          errors: result.errors.slice(0, 5),
        },
      };

      if (!acceptable) {
        if (result.successRate < 0.95) {
          t.error = `Success rate ${(result.successRate * 100).toFixed(1)}% < 95% at ${concurrency} concurrent users`;
          t.rootCause = "Server failing under load — possible rate-limit, OOM, or connection exhaustion";
          t.suggestedFix =
            "Add Redis-backed rate limiting, increase Render instance size, or add caching layer";
        } else {
          t.error = `p95 latency ${result.p95}ms > 8000ms threshold`;
          t.rootCause = "High latency under load — DB query slow or provider API bottleneck";
          t.suggestedFix = "Add database connection pooling (pgBouncer), review slow queries with Supabase advisor";
        }
      }

      tests.push(t);
      acceptable
        ? log.ok(`${t.name} — p50=${result.p50}ms p95=${result.p95}ms rps=${result.rps}`)
        : log.fail(`${t.name} — ${t.error}`);

      // Pause between tiers to let server recover
      if (concurrency < config.maxStressUsers) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  // ── Memory usage report ────────────────────────────────────────────────
  const memMb = process.memoryUsage().heapUsed / 1024 / 1024;
  log.info(`QA runner heap usage after stress: ${memMb.toFixed(1)} MB`);
  tests.push({
    name: "QA runner memory after stress < 512 MB",
    passed: memMb < 512,
    durationMs: 0,
    details: { heapMb: memMb.toFixed(1) },
    error: memMb >= 512 ? `QA runner using ${memMb.toFixed(0)} MB — potential leak in test loop` : undefined,
  });

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 7, name: "Stress Test", tests, totalMs: Date.now() - start, passCount, failCount };
}
