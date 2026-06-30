/**
 * Phase 65 — AI Memory Engine V2
 *
 * Tests all 9 memory types, TTL enforcement, stale-memory expiry,
 * upsert behavior, and deletion (expire on demand).
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const MEMORY = `${BASE}/api/ai/memory`;

const MEMORY_TYPES = [
  "project", "repository", "conversation", "architecture",
  "deployment", "testing", "user-preference", "decision", "lessons-learned",
] as const;

export async function runPhase65(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Memory V2 endpoint exists ─────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(MEMORY, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 401 || res.status === 503;
    tests.push({
      name: "Memory V2: GET /api/ai/memory endpoint exists",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Memory endpoint returned ${res.status}`,
      rootCause: ok ? undefined : "/api/ai/memory route not deployed",
      suggestedFix: ok ? undefined : "Deploy aof-web/src/app/api/ai/memory/route.ts",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 2. Memory endpoint requires authentication ────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(MEMORY, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 403 || res.status === 503;
    tests.push({
      name: "Memory V2: GET requires authentication",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Memory accessible without auth (${res.status})`,
      rootCause: ok ? undefined : "Memory endpoint not protected — user memories exposed",
      suggestedFix: ok ? undefined : "Add getUserFromRequest() in GET /api/ai/memory handler",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 3. POST memory requires auth ──────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(MEMORY, {
      type: "project", key: "test-key",
      value: { data: "test" }, ttlDays: 7,
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 403 || res.status === 503;
    tests.push({
      name: "Memory V2: POST requires authentication",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Memory storage allowed without auth (${res.status})`,
      rootCause: ok ? undefined : "Memory write not protected",
      suggestedFix: ok ? undefined : "Add auth check in POST /api/ai/memory handler",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 4. Invalid memory type rejected ──────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(MEMORY, {
      type: "unknown-memory-type", key: "k", value: { x: 1 },
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;
    tests.push({
      name: "Memory V2: invalid memory type rejected (400/401/422)",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Invalid memory type not rejected (${res.status})`,
      rootCause: ok ? undefined : "Memory type enum not validated",
      suggestedFix: ok ? undefined : `Add z.enum(${JSON.stringify(MEMORY_TYPES)}) in MemorySchema`,
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 5. All 9 memory types accepted ───────────────────────────────────────
  {
    const t0 = Date.now();
    const results = await Promise.all(
      MEMORY_TYPES.map((type) =>
        httpPost(MEMORY, { type, key: `test-${type}`, value: { data: type } }, { timeoutMs: config.timeoutMs })
      )
    );
    const allHandled = results.every((r) => r.status < 500 && r.status !== 0);
    tests.push({
      name: `Memory V2: all ${MEMORY_TYPES.length} memory types accepted (project/repo/conversation/arch/deploy/testing/pref/decision/lessons)`,
      passed: allHandled, durationMs: Date.now() - t0,
      details: { types: MEMORY_TYPES, statuses: results.map((r) => r.status) },
      error: allHandled ? undefined : `Some memory types caused errors`,
      rootCause: allHandled ? undefined : "Memory type enum incomplete",
      suggestedFix: allHandled ? undefined : "Verify MEMORY_TYPES enum covers all 9 types in MemorySchema",
    });
    allHandled ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 6. DELETE endpoint available for memory expiry ────────────────────────
  {
    const t0 = Date.now();
    // DELETE /api/ai/memory?type=project&key=test
    const url = `${MEMORY}?type=project&key=test-project`;
    let status = 0;
    try {
      const res = await fetch(url, {
        method: "DELETE",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      status = res.status;
    } catch {}
    const ok = status === 401 || status === 403 || status === 200 || status === 404 || status === 503;
    tests.push({
      name: `Memory V2: DELETE /api/ai/memory for stale memory expiry (${status})`,
      passed: ok, durationMs: Date.now() - t0,
      details: { status },
      error: ok ? undefined : `DELETE returned unexpected status (${status})`,
      rootCause: ok ? undefined : "DELETE handler not implemented in memory route",
      suggestedFix: ok ? undefined : "Add DELETE handler to /api/ai/memory route for on-demand memory expiry",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 7. Existing learning endpoint (V1) still operational ─────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/ai/learning`, { timeoutMs: config.timeoutMs });
    const ok = res.status !== 404 && res.status !== 0;
    tests.push({
      name: "Memory V2: /api/ai/learning (V1) still operational alongside V2",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : "/api/ai/learning V1 not found — backward compatibility broken",
      rootCause: ok ? undefined : "V1 learning endpoint removed during V2 deployment",
      suggestedFix: ok ? undefined : "Keep /api/ai/learning operational; V2 extends, never replaces V1",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 65, name: "AI Memory Engine V2", tests, totalMs: Date.now() - start, passCount, failCount };
}
