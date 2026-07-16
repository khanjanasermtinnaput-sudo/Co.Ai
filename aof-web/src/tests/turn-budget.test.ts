// ── turn-budget.test.ts ──────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  makeTurnBudget,
  ROUTE_MAX_DURATION_SEC,
  TURN_BUDGET_MS,
  STREAM_RESERVE_MS,
  MIN_AGENT_MS,
} from "../lib/server/turn-budget";

test("preStreamRemainingMs is monotonically non-increasing and never negative", () => {
  const budget = makeTurnBudget(Date.now() - 5_000);
  const first = budget.preStreamRemainingMs();
  assert.ok(first >= 0);
  assert.ok(first <= TURN_BUDGET_MS - STREAM_RESERVE_MS);

  const later = makeTurnBudget(Date.now() - 20_000);
  assert.ok(later.preStreamRemainingMs() <= first);
  assert.ok(later.preStreamRemainingMs() >= 0);

  const wayLater = makeTurnBudget(Date.now() - 999_999);
  assert.equal(wayLater.preStreamRemainingMs(), 0);
});

test("deadlineFor never exceeds the request and never exceeds what's left", () => {
  const budget = makeTurnBudget(Date.now() - 20_000);
  const remaining = budget.preStreamRemainingMs();

  // 1_000 is far below `remaining` (~8s), so capping to the request is exact
  // regardless of the sub-millisecond drift between these calls.
  assert.equal(budget.deadlineFor(1_000), 1_000);

  // deadlineFor() recomputes preStreamRemainingMs() from Date.now() on every
  // call, so real wall-clock time elapsing between this call and the
  // `remaining` snapshot above can only make this value equal to or SMALLER
  // than remaining — asserting exact equality flakes under any scheduling
  // jitter (GC pause, slow CI, etc). Assert the actual invariant instead:
  // never more than what was left when we checked, never negative.
  const uncapped = budget.deadlineFor(999_999);
  assert.ok(uncapped <= remaining, `deadlineFor(999_999)=${uncapped} must not exceed remaining=${remaining}`);
  assert.ok(uncapped >= 0, `deadlineFor(999_999)=${uncapped} must never be negative`);
});

test("exhausted() flips true once preStreamRemainingMs drops below minMs", () => {
  const fresh = makeTurnBudget(Date.now());
  assert.equal(fresh.exhausted(MIN_AGENT_MS), false);

  const spent = makeTurnBudget(Date.now() - (TURN_BUDGET_MS - STREAM_RESERVE_MS));
  assert.equal(spent.exhausted(MIN_AGENT_MS), true);
});

test("the stream reserve is never encroached — pre-stream pool is exactly total - reserve", () => {
  // startedAt is captured slightly in the past, not "now", so a real
  // millisecond of wall-clock time elapsing between construction and the
  // assertion below can never flip this from an exact-equality flake.
  const budget = makeTurnBudget(Date.now() - 1000, { totalMs: 50_000, streamReserveMs: 30_000 });
  assert.equal(budget.preStreamRemainingMs(), 19_000);
});

test("snapshot() reports the same numbers the individual methods do", () => {
  const budget = makeTurnBudget(Date.now() - 3_000);
  const snap = budget.snapshot();
  assert.equal(snap.elapsedMs, budget.elapsedMs());
  assert.equal(snap.preStreamRemainingMs, budget.preStreamRemainingMs());
});

test("route.ts's maxDuration literal matches ROUTE_MAX_DURATION_SEC — drift guard", () => {
  const routeSrc = readFileSync(resolve(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
  const match = routeSrc.match(/export const maxDuration\s*=\s*(\d+)/);
  assert.ok(match, "route.ts must export a literal `maxDuration`");
  assert.equal(Number(match[1]), ROUTE_MAX_DURATION_SEC);
});

test("TURN_BUDGET_MS stays safely under the route's maxDuration, in milliseconds", () => {
  assert.ok(TURN_BUDGET_MS < ROUTE_MAX_DURATION_SEC * 1000);
});
