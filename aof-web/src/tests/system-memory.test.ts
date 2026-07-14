// System Memory (Master Prompt Part 6.2, tier 4/4) — a read-only snapshot of
// the system's own runtime configuration. Locks in that the snapshot is a live
// read of the real single-source-of-truth modules (ROUTE_PRIORITY, EFFORT_LEVELS,
// configuredProviders), not a second hand-maintained copy that could drift.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getSystemMemorySnapshot } from "@/lib/server/system-memory.js";
import { ROUTE_PRIORITY } from "@/lib/server/model-registry.js";
import { EFFORT_LEVELS } from "@/lib/effort.js";

test("getSystemMemorySnapshot's taskRoutePriority is the live ROUTE_PRIORITY object, not a copy that can drift", () => {
  const snapshot = getSystemMemorySnapshot();
  assert.deepEqual(snapshot.taskRoutePriority, ROUTE_PRIORITY);
});

test("getSystemMemorySnapshot's effortLevels mirrors the real EFFORT_LEVELS list", () => {
  const snapshot = getSystemMemorySnapshot();
  assert.deepEqual(snapshot.effortLevels, EFFORT_LEVELS);
});

test("configuredProviders reflects a key passed via overrides", () => {
  const snapshot = getSystemMemorySnapshot({ gemini: "test-key" });
  assert.ok(snapshot.configuredProviders.includes("gemini"));
});

test("checkedAt is a fresh ISO timestamp", () => {
  const before = Date.now();
  const snapshot = getSystemMemorySnapshot();
  const checkedAtMs = new Date(snapshot.checkedAt).getTime();
  assert.ok(checkedAtMs >= before && checkedAtMs <= Date.now() + 5);
});
