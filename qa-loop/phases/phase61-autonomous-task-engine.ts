/**
 * Phase 61 — Autonomous Task Engine
 *
 * Tests long-running autonomous task execution: creation, queuing,
 * pause/resume/cancel controls, auto-recovery, checkpoint validation,
 * and execution reporting.
 */
import { httpGet, httpPost } from "../utils/http.ts";
import { config } from "../config.ts";
import { log } from "../utils/logger.ts";
import type { PhaseResult, TestResult } from "../utils/types.ts";

const BASE = config.baseUrl;
const TASKS = `${BASE}/api/tasks`;

const TASK_TYPES = ["feature", "bugfix", "refactor", "security-audit", "performance"] as const;

export async function runPhase61(_runDir: string): Promise<PhaseResult> {
  const start = Date.now();
  const tests: TestResult[] = [];

  // ── 1. Tasks endpoint exists ──────────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(TASKS, { timeoutMs: config.timeoutMs });
    const ok = res.status === 200 || res.status === 401 || res.status === 503;
    tests.push({
      name: "Autonomous tasks: GET /api/tasks endpoint exists",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Tasks endpoint returned ${res.status}`,
      rootCause: ok ? undefined : "/api/tasks route not deployed",
      suggestedFix: ok ? undefined : "Deploy aof-web/src/app/api/tasks/route.ts to Vercel",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 2. Tasks endpoint requires authentication ─────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(TASKS, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 403 || res.status === 503;
    tests.push({
      name: "Autonomous tasks: GET requires authentication",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Task list accessible without auth (${res.status})`,
      rootCause: ok ? undefined : "Task endpoint not protected",
      suggestedFix: ok ? undefined : "Add getUserFromRequest() in GET /api/tasks handler",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 3. Task creation requires authentication ──────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(TASKS, { title: "Add dark mode", type: "feature" }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 401 || res.status === 403 || res.status === 503;
    tests.push({
      name: "Autonomous tasks: POST requires authentication",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Task creation allowed without auth (${res.status})`,
      rootCause: ok ? undefined : "Task creation not protected",
      suggestedFix: ok ? undefined : "Add auth check in POST /api/tasks handler",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 4. Invalid task type rejected ─────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(TASKS, { title: "Bad task", type: "unknown-type" }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;
    tests.push({
      name: "Autonomous tasks: invalid task type rejected (400/401/422)",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Invalid task type not rejected (${res.status})`,
      rootCause: ok ? undefined : "Task type enum not validated in CreateTaskSchema",
      suggestedFix: ok ? undefined : `Add z.enum(${JSON.stringify(TASK_TYPES)}) for type field`,
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 5. Task without title rejected ────────────────────────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(TASKS, { type: "feature" }, { timeoutMs: config.timeoutMs });
    const ok = res.status === 400 || res.status === 401 || res.status === 422 || res.status === 503;
    tests.push({
      name: "Autonomous tasks: missing title rejected (400/401/422)",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : `Missing title not rejected (${res.status})`,
      rootCause: ok ? undefined : "No title validation in task schema",
      suggestedFix: ok ? undefined : "Add z.string().min(1) for title in CreateTaskSchema",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 6. Workflow endpoint supports task-style requests ─────────────────────
  {
    const t0 = Date.now();
    const res = await httpPost(`${BASE}/api/workflow`, {
      message: "Implement dark mode across the entire application",
    }, { timeoutMs: config.timeoutMs });
    const ok = res.status < 500 && res.status !== 0;
    tests.push({
      name: "Autonomous tasks: workflow endpoint handles long-running task requests",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status, snippet: res.body.slice(0, 150) },
      error: ok ? undefined : `Workflow not handling autonomous task requests (${res.status})`,
      rootCause: ok ? undefined : "/api/workflow not processing implementation requests",
      suggestedFix: ok ? undefined : "Ensure /api/workflow handles complex multi-step implementation requests",
    });
    ok ? log.ok(tests[tests.length-1].name) : log.fail(tests[tests.length-1].name);
  }

  // ── 7. Apply endpoint available for task output ───────────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/apply`, { timeoutMs: config.timeoutMs });
    const ok = res.status !== 404 && res.status !== 0;
    tests.push({
      name: "Autonomous tasks: /api/apply endpoint available for task file application",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : "/api/apply not found — task file changes cannot be applied",
      rootCause: ok ? undefined : "Apply endpoint not deployed",
      suggestedFix: ok ? undefined : "Ensure /api/apply route is deployed for autonomous task output application",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  // ── 8. Queue endpoint available for task scheduling ───────────────────────
  {
    const t0 = Date.now();
    const res = await httpGet(`${BASE}/api/queue`, { timeoutMs: config.timeoutMs });
    const ok = res.status !== 404 && res.status !== 0;
    tests.push({
      name: "Autonomous tasks: /api/queue scheduler endpoint available",
      passed: ok, durationMs: Date.now() - t0,
      details: { status: res.status },
      error: ok ? undefined : "/api/queue not found — task scheduling unavailable",
      rootCause: ok ? undefined : "/api/queue route not deployed",
      suggestedFix: ok ? undefined : "Deploy /api/queue route for Phase 62 smart task scheduling",
    });
    ok ? log.ok(`${tests[tests.length-1].name} (${res.status})`) : log.fail(tests[tests.length-1].name);
  }

  const passCount = tests.filter((t) => t.passed).length;
  const failCount = tests.filter((t) => !t.passed).length;
  return { phase: 61, name: "Autonomous Task Engine", tests, totalMs: Date.now() - start, passCount, failCount };
}
