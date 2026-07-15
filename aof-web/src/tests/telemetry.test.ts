// ── telemetry.test.ts ────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, summarizeTimeline } from "../lib/server/telemetry";
import type { PreStreamTelemetry } from "../lib/server/prestream-dispatch";

test("a turn with no pre-stream work produces an empty, honest timeline — no fabricated spans", () => {
  const t = buildTimeline({ traceId: "req-1", turnStart: Date.now() - 50, outcome: "success" });
  assert.equal(t.traceId, "req-1");
  assert.equal(t.spans.length, 0);
  assert.equal(t.alerts.length, 0);
  assert.ok(t.totalDurationMs >= 50);
});

test("real spans appear only for stages that actually ran, with their real durations", () => {
  const preStream: PreStreamTelemetry = {
    preStreamProviderCalls: 2,
    contextBuilder: { durationMs: 3.2, inputMessages: 5, selectedMessages: 2, charsSaved: 400, degraded: false },
    raa: { executed: true, degraded: false, attempts: 1, durationMs: 900, promptTokens: 200, completionTokens: 80 },
    tmap: { executed: true, degraded: false, attempts: 1, durationMs: 1100, tasks: 3, integrity: "ok", partial: false, warnings: 0, planConfidence: 0.8 },
  };
  const t = buildTimeline({ traceId: "req-2", turnStart: Date.now() - 2000, outcome: "success", preStream });
  const names = t.spans.map((s) => s.name);
  assert.deepEqual(names, ["context-builder", "requirement-analysis", "planner"]);
  assert.equal(t.spans[1].durationMs, 900);
  assert.equal(t.spans.every((s) => s.status === "ok"), true);
});

test("a degraded RAA produces a degraded span AND a warning alert naming the real error code", () => {
  const preStream: PreStreamTelemetry = {
    preStreamProviderCalls: 1,
    raa: { executed: false, degraded: true, attempts: 2, durationMs: 500, errorCode: "AOF_ERROR_008" },
  };
  const t = buildTimeline({ traceId: "req-3", turnStart: Date.now() - 500, outcome: "success", preStream });
  assert.equal(t.spans[0].status, "degraded");
  assert.equal(t.alerts.length, 1);
  assert.equal(t.alerts[0].severity, "warning");
  assert.match(t.alerts[0].message, /AOF_ERROR_008/);
});

test("a skipped orchestration stage is recorded with its real skip reason, not silently dropped", () => {
  const preStream: PreStreamTelemetry = { preStreamProviderCalls: 2, orchestrationSkipped: "single-task" };
  const t = buildTimeline({ traceId: "req-4", turnStart: Date.now() - 100, outcome: "success", preStream });
  const multiAgent = t.spans.find((s) => s.name === "multi-agent");
  assert.ok(multiAgent);
  assert.equal(multiAgent!.status, "skipped");
  assert.equal(multiAgent!.detail?.reason, "single-task");
});

test("budget-enforcer critical/exceeded levels become alerts; healthy does not", () => {
  const healthy = buildTimeline({
    traceId: "req-5",
    turnStart: Date.now() - 10,
    outcome: "success",
    budgetDecision: { level: "healthy", category: "tokens", action: "continue", ratio: 0.1, recommendation: "within budget" },
  });
  assert.equal(healthy.alerts.length, 0);

  const exceeded = buildTimeline({
    traceId: "req-6",
    turnStart: Date.now() - 10,
    outcome: "success",
    budgetDecision: { level: "exceeded", category: "tokens", action: "abort", ratio: 1.2, recommendation: "budget exceeded" },
  });
  assert.equal(exceeded.alerts.length, 1);
  assert.equal(exceeded.alerts[0].severity, "error");
});

test("a failed turn always carries a provider-failure alert", () => {
  const t = buildTimeline({ traceId: "req-7", turnStart: Date.now() - 10, outcome: "failure" });
  assert.ok(t.alerts.some((a) => a.span === "provider" && a.severity === "error"));
});

test("summarizeTimeline flattens into greppable key=value fields without duplicating requestId/durationMs", () => {
  const t = buildTimeline({
    traceId: "req-8",
    turnStart: Date.now() - 100,
    outcome: "success",
    promptCompiler: { promptId: "p1", workflowId: "lite", stageId: "processing", provider: "anthropic", model: "x", promptVersion: "1.0.0", compileMs: 1.5, estTokens: 50, optimizationRatio: 0, cacheHit: false },
  });
  const flat = summarizeTimeline(t);
  assert.equal(flat.spanCount, 1);
  assert.match(String(flat.spans), /prompt-compiler:ok/);
  assert.equal(flat.alertCount, undefined); // zero alerts ⇒ omitted, not fabricated as 0-with-noise
  assert.ok(!("traceId" in flat) && !("durationMs" in flat) && !("requestId" in flat));
});
