// ── workflow-context.ts — local Context Builder (no network, no LLM) ─────────
// Co.AI Master Prompt Part 4.2: Context Builder must execute locally, save
// tokens (never add them), and degrade to "recent messages only" whenever
// nothing scores as relevant or anything internal goes wrong. These tests lock
// in that contract plus the script-aware tokenizer's Thai coverage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorkflowContext, type WorkflowHistoryItem } from "../lib/server/workflow-context";

function turn(role: "user" | "assistant", content: string): WorkflowHistoryItem {
  return { role, content };
}

test("never throws on malformed, huge, or empty input", () => {
  assert.doesNotThrow(() => buildWorkflowContext({ message: "", history: [] }));
  assert.doesNotThrow(() => buildWorkflowContext({ message: "hi", history: [] }));
  assert.doesNotThrow(() =>
    buildWorkflowContext({
      message: "x".repeat(50_000),
      history: Array.from({ length: 20 }, (_, i) => turn(i % 2 ? "assistant" : "user", "y".repeat(10_000))),
    }),
  );
  // @ts-expect-error deliberately malformed input — must degrade, not throw
  assert.doesNotThrow(() => buildWorkflowContext({ message: null, history: null }));
  // @ts-expect-error deliberately malformed input — must degrade, not throw
  assert.doesNotThrow(() => buildWorkflowContext({ message: "hi", history: [{ role: "user" }] }));
});

test("stats.outputChars never exceeds stats.inputChars (the token-saving invariant)", () => {
  const history = [
    turn("user", "My project uses Next.js and Supabase for the backend."),
    turn("assistant", "Understood, Next.js with Supabase."),
    turn("user", "The database schema has a users table and a posts table."),
    turn("assistant", "Got it — users and posts tables."),
    turn("user", "How should I deploy this Next.js Supabase project?"),
    turn("assistant", "You could deploy to Vercel."),
    turn("user", "What's the best way to structure the posts table?"),
  ];
  for (const message of ["How do I deploy?", "Tell me about the posts table schema.", "Unrelated question about cats."]) {
    const result = buildWorkflowContext({ message, history });
    assert.ok(
      result.stats.outputChars <= result.stats.inputChars,
      `outputChars (${result.stats.outputChars}) must not exceed inputChars (${result.stats.inputChars}) for "${message}"`,
    );
  }
});

test("returned history REPLACES the original — length is capped at recentTurns, not merged with it", () => {
  const history = Array.from({ length: 20 }, (_, i) => turn(i % 2 ? "assistant" : "user", `message ${i} about widgets`));
  const result = buildWorkflowContext({ message: "tell me about widgets", history, recentTurns: 4 });
  assert.ok(result.history.length <= 4);
});

test("a relevant older message is selected; an irrelevant one is dropped", () => {
  const history = [
    turn("user", "My favorite color is blue and I like hiking on weekends."),
    turn("assistant", "That's nice! Blue is a calming color."),
    turn("user", "The API rate limit is 100 requests per minute per user."),
    turn("assistant", "Got it — 100 req/min per user."),
    turn("user", "What's my favorite color again?"),
    turn("assistant", "You like hiking too."),
    turn("user", "Actually, remind me what the rate limit was?"),
  ];
  const result = buildWorkflowContext({ message: "What was the API rate limit again?", history, recentTurns: 2 });
  assert.ok(result.digest.includes("100 requests per minute"), "the relevant rate-limit turn should be selected");
  assert.ok(!result.digest.includes("hiking"), "the unrelated hiking turn should not be selected");
});

test("degraded: true and recent-only when nothing scores as relevant", () => {
  const history = [
    turn("user", "Tell me about giraffes."),
    turn("assistant", "Giraffes are tall mammals."),
    turn("user", "Tell me about volcanoes."),
    turn("assistant", "Volcanoes are geological formations."),
    turn("user", "What's the weather like on Mars?"),
  ];
  const result = buildWorkflowContext({
    message: "Explain quantum entanglement in cryptography.",
    history,
    recentTurns: 1,
  });
  assert.equal(result.stats.degraded, true);
  assert.equal(result.digest, "");
  assert.equal(result.history.length, 1);
});

test("Thai: a relevant Thai turn is selected via trigram overlap; an unrelated Thai turn is not", () => {
  const history = [
    turn("user", "โปรเจกต์ของฉันใช้ฐานข้อมูล Supabase และ Next.js"),
    turn("assistant", "เข้าใจแล้ว ใช้ Supabase กับ Next.js"),
    turn("user", "วันนี้อากาศดีมากที่กรุงเทพ"),
    turn("assistant", "ดีจังเลย"),
    turn("user", "แมวของฉันชอบนอนตอนกลางวันมาก"),
    turn("assistant", "แมวน่ารักจังเลย"),
    turn("user", "เมื่อคืนผมดูหนังจบดึกมากเลย"),
    turn("assistant", "หนังเรื่องอะไรเหรอ"),
    turn("user", "ฉันควร deploy โปรเจกต์นี้อย่างไร"),
  ];
  const result = buildWorkflowContext({
    message: "ช่วยบอกวิธี deploy โปรเจกต์ Supabase Next.js หน่อย",
    history,
    recentTurns: 1,
  });
  assert.equal(result.stats.degraded, false);
  assert.ok(result.digest.includes("Supabase"), "the relevant Thai/tech turn should be selected");
  assert.ok(!result.digest.includes("อากาศ"), "the unrelated weather turn should not be selected");
});

test("mixed Thai/English history scores correctly for an English query", () => {
  const history = [
    turn("user", "ผมชื่อสมชาย อายุ 30 ปี"),
    turn("assistant", "ยินดีที่ได้รู้จักครับคุณสมชาย"),
    turn("user", "The rate limit for the payments API is 50 requests per second."),
    turn("assistant", "Noted — 50 req/s for payments."),
    turn("user", "What's my name?"),
  ];
  const result = buildWorkflowContext({ message: "What was the payments API rate limit?", history, recentTurns: 1 });
  assert.ok(result.digest.includes("50 requests per second"));
});

test("perf: 20 messages of 2000 chars each completes comfortably under 20ms", () => {
  const history = Array.from({ length: 20 }, (_, i) =>
    turn(i % 2 ? "assistant" : "user", `Turn ${i}: ${"lorem ipsum dolor sit amet ".repeat(70)}`),
  );
  const start = performance.now();
  buildWorkflowContext({ message: "lorem ipsum dolor sit amet, tell me more", history });
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 20, `expected < 20ms, took ${elapsed.toFixed(2)}ms`);
});
