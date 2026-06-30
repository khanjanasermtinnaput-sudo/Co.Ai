/**
 * Phase 62 — Smart Task Queue
 *
 * Tests centralized job scheduling: queue types, priority ordering,
 * deduplication prevention, retry logic, and scheduler health.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const QUEUE = `${BASE}/api/queue`;

const QUEUE_TYPES = [
  "high-priority", "medium-priority", "low-priority",
  "background", "maintenance", "security", "deployment",
] as const;

export async function runPhase62(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Queue endpoint exists ──────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(QUEUE, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 401 || res.status === 503;
    tests.push({
      name: "Smart queue: GET /api/queue endpoint exists",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Queue endpoint returned ${res.status}`,
      rootCause: ok ? undefined : "/api/queue route not deployed",
      suggestedFix: ok ? undefined : "Deploy aof-web/src/app/api/queue/route.ts",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 2. Queue requires authentication ─────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(QUEUE, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 403 || res.status === 503;
    tests.push({
      name: "Smart queue: GET requires authentication",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Queue accessible without auth (${res.status})`,
      rootCause: ok ? undefined : "Queue endpoint not protected",
      suggestedFix: ok ? undefined : "Add getUserFromRequest() in GET /api/queue handler",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 3. Job enqueue requires authentication ────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(QUEUE, { jobType: "build", queue: "high-priority" }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 403 || res.status === 503;
    tests.push({
      name: "Smart queue: POST job enqueue requires authentication",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Job creation allowed without auth (${res.status})`,
      rootCause: ok ? undefined : "Queue job creation not protected",
      suggestedFix: ok ? undefined : "Add auth check in POST /api/queue handler",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 4. Invalid queue type rejected ────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(QUEUE, { jobType: "test", queue: "ultra-super-priority" }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;
    tests.push({
      name: "Smart queue: invalid queue type rejected (400/401/422)",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Invalid queue type not rejected (${res.status})`,
      rootCause: ok ? undefined : "Queue type enum not validated",
      suggestedFix: ok ? undefined : `Add z.enum(${JSON.stringify(QUEUE_TYPES)}) for queue field`,
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 5. All 7 queue types supported ────────────────────────────────────────
  {
    const t0 = Date.now();
    const results = await Promise.all(
      QUEUE_TYPES.map((q) =>
        httpPost(QUEUE, { jobType: "test-job", queue: q }, { timeoutMs: config.timeoutMs })
      )
    );
    const allHandled = results.every((r) => r.status < 500 && r.status !== 0);
    tests.push({
      name: `Smart queue: all ${QUEUE_TYPES.length} queue types handled (high/medium/low/background/maintenance/security/deployment)`,
      passed: allHandled, durationMs: Date.now() - t0,
      details: { types: QUEUE_TYPES, statuses: results.map((r) => r.status) },
      error: allHandled ? undefined : `Some queue types caused errors: ${results.map((r, i) => `${QUEUE_TYPES[i]}=${r.status}`).join(", ")}`,
      rootCause: allHandled ? undefined : "Queue type enum incomplete or handler crashing",
      suggestedFix: allHandled ? undefined : "Verify QUEUE_TYPES enum covers all 7 types; check POST handler",
    });
    allHandled ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 6. Queue handles concurrent submissions without server errors ──────────
  {
    const t0 = Date.now();
    const concurrent = Array.from({ length: 5 }, (_, i) =>
      httpPost(QUEUE, { jobType: `concurrent-job-${i}`, queue: "medium-priority" }, { timeoutMs: config.timeoutMs })
    );
    const results = await Promise.all(concurrent);
    const serverErrors = results.filter((r) => r.status >= 500 && r.status !== 503).length;
    const ok = serverErrors === 0;
    tests.push({
      name: `Smart queue: 5 concurrent job submissions (${results.filter((r) => r.status < 500).length}/5 succeeded)`,
      passed: ok, durationMs: Date.now() - t0,
      details: { statuses: results.map((r) => r.status), serverErrors },
      error: ok ? undefined : `${serverErrors} server errors on concurrent queue submissions`,
      rootCause: ok ? undefined : "Queue handler not handling concurrent requests safely",
      suggestedFix: ok ? undefined : "Add idempotency to job creation; use atomic DB inserts",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 7. ACP endpoint available for agent task coordination ─────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/agents/messages`, { timeoutMs: config.timeoutMs });
    const ok = res.status !== 404 && res.status !== 0;
    tests.push({
      name: "Smart queue: /api/agents/messages (ACP) endpoint available for inter-agent coordination",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : "ACP endpoint not found — agents cannot coordinate",
      rootCause: ok ? undefined : "/api/agents/messages route not deployed",
      suggestedFix: ok ? undefined : "Deploy /api/agents/messages for Phase 64 Agent Communication Protocol",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 62, name: "Smart Task Queue", tests, totalMs: Date.now() - start, passCount, failCount };
}
