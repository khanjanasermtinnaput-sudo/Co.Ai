import { test } from "node:test";
import assert from "node:assert/strict";
import { useUsageStore, estimateTokensFor } from "../store/usage-store";

function reset() {
  useUsageStore.getState().reset();
}

test("recordMessage increments count and tokens", () => {
  reset();
  useUsageStore.getState().recordMessage(120);
  useUsageStore.getState().recordMessage(80);
  const s = useUsageStore.getState();
  assert.equal(s.messages, 2);
  assert.equal(s.tokens, 200);
});

test("recordSearch increments searches", () => {
  reset();
  useUsageStore.getState().recordSearch();
  useUsageStore.getState().recordSearch();
  assert.equal(useUsageStore.getState().searches, 2);
});

test("ensureToday rolls counters over when the day changes", () => {
  reset();
  useUsageStore.getState().recordMessage(50);
  // Simulate a stale day, then roll over.
  useUsageStore.setState({ date: "2000-01-01" });
  useUsageStore.getState().ensureToday();
  const s = useUsageStore.getState();
  assert.equal(s.messages, 0);
  assert.equal(s.tokens, 0);
  assert.notEqual(s.date, "2000-01-01");
});

test("estimateTokensFor approximates length/4", () => {
  assert.equal(estimateTokensFor("12345678"), 2); // 8 / 4
  assert.equal(estimateTokensFor(""), 0);
});

test("negative token inputs are clamped to zero", () => {
  reset();
  useUsageStore.getState().recordMessage(-100);
  assert.equal(useUsageStore.getState().tokens, 0);
  assert.equal(useUsageStore.getState().messages, 1);
});
