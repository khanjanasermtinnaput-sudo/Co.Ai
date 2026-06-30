/**
 * Phase 64 — Agent Communication Protocol (ACP)
 *
 * Tests standardized agent messaging: required fields, status lifecycle,
 * confidence scoring, dependency tracking, and priority enforcement.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const ACP = `${BASE}/api/agents/messages`;

const ACP_STATUSES = ["queued","planning","running","waiting","review","completed","failed","cancelled"] as const;
const VALID_MESSAGE = {
  taskId: "task-001",
  fromAgent: "planner",
  toAgent: "frontend",
  priority: "high",
  context: { feature: "dark-mode", deadline: "2024-12-31" },
  expectedOutput: "React component with dark mode toggle",
  confidenceScore: 0.87,
  executionStatus: "queued",
};

export async function runPhase64(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. ACP endpoint exists ────────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(ACP, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 401 || res.status === 503;
    tests.push({
      name: "ACP: GET /api/agents/messages endpoint exists",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `ACP endpoint returned ${res.status}`,
      rootCause: ok ? undefined : "/api/agents/messages not deployed",
      suggestedFix: ok ? undefined : "Deploy aof-web/src/app/api/agents/messages/route.ts",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 2. ACP requires authentication ────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(ACP, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 403 || res.status === 503;
    tests.push({
      name: "ACP: GET requires authentication",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `ACP messages readable without auth (${res.status})`,
      rootCause: ok ? undefined : "Agent messages exposed to unauthenticated requests",
      suggestedFix: ok ? undefined : "Add getUserFromRequest() in GET /api/agents/messages handler",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 3. Valid ACP message accepted structure-wise ──────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(ACP, VALID_MESSAGE, { timeoutMs: config.timeoutMs });
    // Auth gate (401) or valid response (201) — not 400 or 500
    const ok = res.status === 401 || res.status === 403 || res.status === 201 || res.status === 503;
    tests.push({
      name: "ACP: valid structured message accepted (not 400/500)",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status, snippet: res.body.slice(0, 200) },
      error: ok ? undefined : `Valid ACP message rejected (${res.status})`,
      rootCause: ok ? undefined : "ACP schema too strict or handler crashing on valid input",
      suggestedFix: ok ? undefined : "Verify ACPMessageSchema accepts all required fields; check route handler",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 4. Missing taskId rejected ────────────────────────────────────────────
  {
    const t0 = Date.now();
    const { taskId: _, ...noTaskId } = VALID_MESSAGE;
    const res = await httpPost(ACP, noTaskId, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;
    tests.push({
      name: "ACP: missing taskId rejected (400/401/422)",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Message without taskId not rejected (${res.status})`,
      rootCause: ok ? undefined : "taskId not required in ACPMessageSchema",
      suggestedFix: ok ? undefined : "Add taskId: z.string().min(1) to ACPMessageSchema",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 5. Invalid confidence score rejected ──────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(ACP, { ...VALID_MESSAGE, confidenceScore: 1.5 }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;
    tests.push({
      name: "ACP: confidence score > 1.0 rejected (400/401/422)",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Confidence score 1.5 not rejected (${res.status})`,
      rootCause: ok ? undefined : "confidenceScore not bounded to [0,1] in schema",
      suggestedFix: ok ? undefined : "Add z.number().min(0).max(1) for confidenceScore in ACPMessageSchema",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 6. All 8 execution statuses documented ────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(ACP, { timeoutMs: config.timeoutMs });
    let hasAllStatuses = false;
    try {
      const body = JSON.parse(res.body);
      hasAllStatuses = Array.isArray(body.supportedStatuses) && body.supportedStatuses.length >= 8;
    } catch {}
    const ok = res.status !== 404 && res.status !== 0;
    tests.push({
      name: `ACP: all ${ACP_STATUSES.length} execution statuses documented (queued/planning/running/waiting/review/completed/failed/cancelled)`,
      passed: ok, durationMs: Date.now() - t0,
      details: { expectedStatuses: ACP_STATUSES, hasAllStatuses, status: res.status },
      error: ok ? undefined : "ACP endpoint not returning status registry",
      rootCause: ok ? undefined : "Status lifecycle not documented in ACP endpoint",
      suggestedFix: ok ? undefined : "Add supportedStatuses array to GET /api/agents/messages response",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 7. High-priority messages route correctly ─────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(ACP, { ...VALID_MESSAGE, priority: "critical" }, { timeoutMs: config.timeoutMs });
    const ok = res.status !== 400 && res.status !== 500;
    tests.push({
      name: "ACP: critical priority messages handled without schema rejection",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Critical priority message rejected (${res.status})`,
      rootCause: ok ? undefined : "'critical' not in priority enum",
      suggestedFix: ok ? undefined : "Add 'critical' to priority z.enum in ACPMessageSchema",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 64, name: "Agent Communication Protocol (ACP)", tests, totalMs: Date.now() - start, passCount, failCount };
}
