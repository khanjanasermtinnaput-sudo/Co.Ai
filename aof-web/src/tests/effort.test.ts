import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EFFORT_LEVELS,
  clampEffort,
  defaultEffortFor,
  effortIntentFromLevel,
  effortIntentsFor,
  effortLevelsFor,
  effortMaxTokens,
  effortPolicy,
  effortSystemAddon,
  effortTemperature,
  normalizeEffort,
  resolveEffortIntent,
  tierAllowsSearch,
} from "../lib/effort";
import type { EffortLevel } from "../lib/types";

test("effortLevelsFor: Ypertatos spans the whole scale, others stay baseline", () => {
  assert.deepEqual(effortLevelsFor("lite"), ["low", "normal", "high"]);
  assert.deepEqual(effortLevelsFor("normal"), ["low", "normal", "high"]);
  assert.deepEqual(effortLevelsFor("1.0"), ["low", "normal", "high"]);
  assert.deepEqual(effortLevelsFor("pro"), ["low", "normal", "high", "ultra", "extreme"]);
  assert.deepEqual(effortLevelsFor("titan"), []);
});

test("clampEffort snaps an out-of-range level onto the model's scale", () => {
  // Ypertatos@Extreme → Kanon can't do Extreme → falls back to Kanon's default.
  assert.equal(clampEffort("normal", "extreme"), "normal");
  // High is valid on both, so switching keeps it.
  assert.equal(clampEffort("normal", "high"), "high");
  assert.equal(clampEffort("pro", "extreme"), "extreme");
  assert.equal(defaultEffortFor("pro"), "ultra");
});

test("normalizeEffort coerces junk to normal, accepts real levels", () => {
  assert.equal(normalizeEffort("extreme"), "extreme");
  assert.equal(normalizeEffort("nope"), "normal");
  assert.equal(normalizeEffort(undefined), "normal");
  assert.equal(normalizeEffort(42), "normal");
  for (const l of EFFORT_LEVELS) assert.equal(normalizeEffort(l), l);
});

test("token budget is monotonic across effort and respects the level caps", () => {
  const base = 1000;
  const budgets = EFFORT_LEVELS.map((l) => effortMaxTokens(base, l));
  for (let i = 1; i < budgets.length; i++) {
    assert.ok(budgets[i] > budgets[i - 1], `budget rises ${EFFORT_LEVELS[i - 1]}→${EFFORT_LEVELS[i]}`);
  }
  // A large agent base (code-gen) is clamped, not left unbounded.
  assert.equal(effortMaxTokens(4000, "low"), 700); // hits the low ceiling
  assert.equal(effortMaxTokens(4000, "extreme"), 8000); // hits the extreme ceiling
  // A tiny base is lifted to the level floor.
  assert.equal(effortMaxTokens(100, "extreme"), 4000);
});

test("temperature can only be pulled down by effort, never raised", () => {
  // Agent tuned deterministic (0.4) stays 0.4 even at low effort (policy 0.7).
  assert.equal(effortTemperature(0.4, "low"), 0.4);
  // Chatty agent (0.7) is focused by high effort (policy 0.5).
  assert.equal(effortTemperature(0.7, "high"), 0.5);
  // Monotonic non-increasing across the scale for a fixed base.
  const temps = EFFORT_LEVELS.map((l) => effortTemperature(0.9, l));
  for (let i = 1; i < temps.length; i++) assert.ok(temps[i] <= temps[i - 1]);
});

test("clarifyFirst gates only at extreme", () => {
  const clarifyFirst = (l: EffortLevel) => effortPolicy(l).clarifyFirst;
  assert.equal(clarifyFirst("low"), false);
  assert.equal(clarifyFirst("normal"), false);
  assert.equal(clarifyFirst("high"), false);
  assert.equal(clarifyFirst("ultra"), false);
  assert.equal(clarifyFirst("extreme"), true);
});

test("tierAllowsSearch: Mikros never grounds with search, every other tier does", () => {
  assert.equal(tierAllowsSearch("lite"), false);
  assert.equal(tierAllowsSearch("normal"), true);
  assert.equal(tierAllowsSearch("pro"), true);
  assert.equal(tierAllowsSearch("titan"), true);
});

test("effortIntentsFor: Maximum only appears on Ypertatos, Titan offers none", () => {
  assert.deepEqual(effortIntentsFor("lite"), ["auto", "fast", "balanced", "deep"]);
  assert.deepEqual(effortIntentsFor("normal"), ["auto", "fast", "balanced", "deep"]);
  assert.deepEqual(effortIntentsFor("1.0"), ["auto", "fast", "balanced", "deep"]);
  assert.deepEqual(effortIntentsFor("pro"), ["auto", "fast", "balanced", "deep", "maximum"]);
  assert.deepEqual(effortIntentsFor("titan"), []);
});

test("resolveEffortIntent maps onto the real EffortLevel scale, per tier", () => {
  assert.equal(resolveEffortIntent("normal", "auto"), defaultEffortFor("normal"));
  assert.equal(resolveEffortIntent("normal", "fast"), "low");
  assert.equal(resolveEffortIntent("normal", "balanced"), "normal");
  // Deep tops out at Kanon's ceiling (no Ultra/Extreme on its scale)...
  assert.equal(resolveEffortIntent("normal", "deep"), "high");
  // ...but reaches for Ypertatos's own default (Ultra) on its wider scale.
  assert.equal(resolveEffortIntent("pro", "auto"), defaultEffortFor("pro"));
  assert.equal(resolveEffortIntent("pro", "deep"), "ultra");
  assert.equal(resolveEffortIntent("pro", "maximum"), "extreme");
});

test("effortIntentFromLevel round-trips a persisted level into an intent chip", () => {
  assert.equal(effortIntentFromLevel("normal", "low"), "fast");
  assert.equal(effortIntentFromLevel("normal", "normal"), "balanced");
  assert.equal(effortIntentFromLevel("normal", "high"), "deep");
  assert.equal(effortIntentFromLevel("pro", "ultra"), "deep");
  assert.equal(effortIntentFromLevel("pro", "extreme"), "maximum");
  // Round-trip: resolving an intent then reading it back never lands outside
  // that same intent's own bucket for every tier/intent combination.
  for (const id of ["lite", "normal", "pro"] as const) {
    for (const intent of effortIntentsFor(id)) {
      if (intent === "auto") continue; // auto resolves to a real level, not a fixed bucket
      const level = resolveEffortIntent(id, intent);
      assert.equal(effortIntentFromLevel(id, level), intent);
    }
  }
});

test("system addon: only extreme + conversational asks the user to clarify first", () => {
  assert.match(effortSystemAddon("low"), /LOW/);
  assert.match(effortSystemAddon("high"), /runnable code/);
  // Extreme conversational → contains the clarify instruction.
  assert.match(effortSystemAddon("extreme", { conversational: true }), /clarifying questions/);
  // Extreme one-shot generator → no clarify instruction.
  assert.doesNotMatch(effortSystemAddon("extreme", { conversational: false }), /clarifying questions/);
  // Non-extreme conversational → never clarifies.
  assert.doesNotMatch(effortSystemAddon("high", { conversational: true }), /clarifying questions/);
});
