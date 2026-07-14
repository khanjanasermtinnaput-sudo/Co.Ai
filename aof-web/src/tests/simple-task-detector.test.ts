import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSimpleTask, simpleTaskSystemAddon } from "../lib/server/simple-task-detector";

// ── Simple Task examples (from the Master Prompt spec) ─────────────────────────

test("simple: greeting", () => {
  assert.equal(detectSimpleTask("สวัสดี").category, "simple");
});

test("simple: bare arithmetic", () => {
  assert.equal(detectSimpleTask("2+2 เท่ากับเท่าไหร่").category, "simple");
});

test("simple: translation request", () => {
  assert.equal(detectSimpleTask("แปลคำนี้").category, "simple");
});

test("simple: meaning/definition request", () => {
  assert.equal(detectSimpleTask("ความหมายของคำนี้").category, "simple");
});

test("simple: rewrite request", () => {
  assert.equal(detectSimpleTask("เขียนประโยคนี้ใหม่").category, "simple");
});

// ── Medium Task examples ────────────────────────────────────────────────────────

test("medium: explain a concept", () => {
  assert.equal(detectSimpleTask("อธิบาย OAuth").category, "medium");
});

test("medium: how to use a library feature (no action-verb-on-code)", () => {
  assert.equal(detectSimpleTask("วิธีใช้ React Hook").category, "medium");
});

test("medium: conceptual question that happens to mention a code noun", () => {
  // Must NOT trip light-coding just because "class" appears — there's no
  // action verb paired with it, so this is a definition question, not a task.
  assert.equal(detectSimpleTask("Python class คืออะไร").category, "medium");
});

// ── Light Coding Task examples ──────────────────────────────────────────────────

test("light-coding: fix this error", () => {
  assert.equal(detectSimpleTask("แก้ error นี้").category, "light-coding");
});

test("light-coding: write this function", () => {
  assert.equal(detectSimpleTask("เขียน function นี้").category, "light-coding");
});

test("light-coding: explain this code", () => {
  assert.equal(detectSimpleTask("อธิบาย code นี้").category, "light-coding");
});

test("light-coding: hard signal — code fence wins regardless of wording", () => {
  assert.equal(detectSimpleTask("```const x = 1;```").category, "light-coding");
});

test("light-coding: hard signal — stack trace / error message", () => {
  assert.equal(detectSimpleTask("TypeError: undefined is not a function").category, "light-coding");
});

// ── Reasons are always populated, never leak the raw message ───────────────────

test("every detection carries a non-empty reason", () => {
  for (const msg of ["สวัสดี", "อธิบาย OAuth", "แก้ error นี้", "random unrelated text"]) {
    const d = detectSimpleTask(msg);
    assert.ok(d.reason.length > 0);
  }
});

// ── System addon ─────────────────────────────────────────────────────────────

test("simpleTaskSystemAddon: distinct instruction per category", () => {
  assert.match(simpleTaskSystemAddon("simple"), /short, direct/i);
  assert.match(simpleTaskSystemAddon("medium"), /clear explanation/i);
  assert.match(simpleTaskSystemAddon("light-coding"), /code itself/i);
});

// ── Performance requirement: <10ms per call ─────────────────────────────────────

test("classification is fast (<10ms) over a batch of calls", () => {
  const messages = [
    "สวัสดี",
    "2+2 เท่ากับเท่าไหร่",
    "อธิบาย OAuth",
    "แก้ error นี้",
    "วิธีใช้ React Hook",
    "a".repeat(500),
  ];
  const start = performance.now();
  for (let i = 0; i < 200; i++) {
    for (const m of messages) detectSimpleTask(m);
  }
  const totalMs = performance.now() - start;
  const perCallMs = totalMs / (200 * messages.length);
  assert.ok(perCallMs < 10, `expected <10ms/call, got ${perCallMs}ms`);
});
