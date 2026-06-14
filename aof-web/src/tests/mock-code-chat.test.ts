import { test } from "node:test";
import assert from "node:assert/strict";
import { mockCodeChat } from "../lib/mock.js";
import { hasBrief } from "../lib/raa.js";

// Fast mode: abort the signal so streamText returns immediately;
// mockCodeChat still returns the full reply text it built.
function fast() {
  const ac = new AbortController();
  ac.abort();
  return { onToken: () => {}, signal: ac.signal };
}

test("mockCodeChat replies to 'hi' naturally and does NOT start a project", async () => {
  const text = await mockCodeChat("hi", fast());
  assert.ok(text.length > 0);
  assert.equal(hasBrief(text), false);
  assert.ok(!text.includes("===REQUIREMENT SUMMARY==="));
});

test("mockCodeChat replies to Thai greeting in Thai", async () => {
  const text = await mockCodeChat("สวัสดี", fast());
  assert.ok(text.length > 0);
  assert.equal(hasBrief(text), false);
  // Thai reply should contain Thai characters
  assert.ok(/[ก-๙]/.test(text));
});

test("mockCodeChat does NOT produce a brief for tech questions", async () => {
  const text = await mockCodeChat("Next.js vs React — which is better?", fast());
  assert.equal(hasBrief(text), false);
  assert.ok(!text.includes("===REQUIREMENT SUMMARY==="));
});

test("mockCodeChat answers 'thanks' with a short natural reply", async () => {
  const text = await mockCodeChat("thanks", fast());
  assert.ok(text.length > 0);
  assert.equal(hasBrief(text), false);
});

test("mockCodeChat never dumps a requirements form on a general question", async () => {
  const text = await mockCodeChat("how do I handle state in React?", fast());
  assert.ok(text.length > 0);
  assert.equal(hasBrief(text), false);
  assert.ok(!text.includes("Task Type:"));
  assert.ok(!text.includes("Tech Stack:"));
});

test("mockCodeChat: Thai tech question gets a Thai reply", async () => {
  const text = await mockCodeChat("React กับ Vue ต่างกันยังไง", fast());
  assert.ok(/[ก-๙]/.test(text));
  assert.equal(hasBrief(text), false);
});
