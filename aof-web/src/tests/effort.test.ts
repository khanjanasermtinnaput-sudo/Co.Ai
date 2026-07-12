import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EFFORT_LEVELS,
  clampEffort,
  defaultEffortFor,
  effortLevelsFor,
  effortMaxTokens,
  effortPolicy,
  effortSystemAddon,
  effortTemperature,
  normalizeEffort,
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

test("workflow / deepThink / clarifyFirst gate at the right levels", () => {
  const flags = (l: EffortLevel) => {
    const p = effortPolicy(l);
    return [p.workflow, p.deepThink, p.clarifyFirst];
  };
  assert.deepEqual(flags("low"), [false, false, false]);
  assert.deepEqual(flags("normal"), [false, false, false]);
  assert.deepEqual(flags("high"), [true, false, false]);
  assert.deepEqual(flags("ultra"), [true, true, false]);
  assert.deepEqual(flags("extreme"), [true, true, true]);
});

test("tierAllowsSearch: Mikros never grounds with search, every other tier does", () => {
  assert.equal(tierAllowsSearch("lite"), false);
  assert.equal(tierAllowsSearch("normal"), true);
  assert.equal(tierAllowsSearch("pro"), true);
  assert.equal(tierAllowsSearch("titan"), true);
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
