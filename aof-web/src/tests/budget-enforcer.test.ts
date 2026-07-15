// ── budget-enforcer.test.ts ──────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { enforcementFor, DEFAULT_THRESHOLDS } from "../lib/server/budget-enforcer";

test("well under both budgets ⇒ healthy/continue", () => {
  const d = enforcementFor({ elapsedMs: 1_000, totalPreStreamPoolMs: 28_000 }, { totalBudget: 1_000, contextWindow: 200_000 });
  assert.equal(d.level, "healthy");
  assert.equal(d.action, "continue");
});

test("time crossing the warning threshold ⇒ warning/optimize, category=time", () => {
  const d = enforcementFor(
    { elapsedMs: 24_000, totalPreStreamPoolMs: 28_000 }, // 85.7%
    { totalBudget: 1_000, contextWindow: 200_000 },
    DEFAULT_THRESHOLDS,
  );
  assert.equal(d.level, "warning");
  assert.equal(d.action, "optimize");
  assert.equal(d.category, "time");
});

test("tokens crossing the critical threshold ⇒ critical/escalate, category=tokens", () => {
  const d = enforcementFor(
    { elapsedMs: 1_000, totalPreStreamPoolMs: 28_000 },
    { totalBudget: 192_000, contextWindow: 200_000 }, // 96%
    DEFAULT_THRESHOLDS,
  );
  assert.equal(d.level, "critical");
  assert.equal(d.action, "escalate");
  assert.equal(d.category, "tokens");
});

test("either dimension at or past its limit ⇒ exceeded/abort", () => {
  const d = enforcementFor({ elapsedMs: 30_000, totalPreStreamPoolMs: 28_000 }, { totalBudget: 1_000, contextWindow: 200_000 });
  assert.equal(d.level, "exceeded");
  assert.equal(d.action, "abort");
  assert.equal(d.category, "time");
  assert.ok(d.ratio > 1, "ratio is never clamped — real overrun magnitude stays visible");
});

test("the WORSE of time/tokens drives the decision, whichever it is", () => {
  const timeWorse = enforcementFor(
    { elapsedMs: 27_000, totalPreStreamPoolMs: 28_000 }, // ~96%
    { totalBudget: 1_000, contextWindow: 200_000 }, // ~0.5%
  );
  assert.equal(timeWorse.category, "time");

  const tokensWorse = enforcementFor(
    { elapsedMs: 1_000, totalPreStreamPoolMs: 28_000 }, // ~3.6%
    { totalBudget: 195_000, contextWindow: 200_000 }, // 97.5%
  );
  assert.equal(tokensWorse.category, "tokens");
});

test("a zero/absent limit never drives a level on its own", () => {
  const d = enforcementFor({ elapsedMs: 999_999, totalPreStreamPoolMs: 0 }, { totalBudget: 999_999, contextWindow: 0 });
  assert.equal(d.level, "healthy");
});

test("recommendation text names the worse category, not a generic message", () => {
  const d = enforcementFor({ elapsedMs: 27_500, totalPreStreamPoolMs: 28_000 }, { totalBudget: 0, contextWindow: 200_000 });
  assert.match(d.recommendation, /wall-clock time/);
});
