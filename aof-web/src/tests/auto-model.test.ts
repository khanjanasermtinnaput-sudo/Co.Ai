import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAutoModel } from "../lib/auto-model.js";
import type { Attachment } from "../lib/types.js";

function att(kind: Attachment["kind"], name = "file.txt"): Attachment {
  return { id: "1", kind, name, mime: "text/plain", size: 100 };
}

test("short everyday question resolves to Mikros (lite)", () => {
  const r = resolveAutoModel("What time is it in Tokyo?");
  assert.equal(r.model, "lite");
  assert.ok(r.reason.length > 0);
});

test("coding task resolves to Kanon (normal) with a real reason", () => {
  const r = resolveAutoModel("Write me a Python function to reverse a string");
  assert.equal(r.model, "normal");
  assert.match(r.reason, /coding/);
});

test("math task resolves to Kanon", () => {
  const r = resolveAutoModel("Solve this equation: 2x + 4 = 10");
  assert.equal(r.model, "normal");
});

test("a code attachment forces Kanon regardless of message text", () => {
  const r = resolveAutoModel("what does this do", [att("code", "app.ts")]);
  assert.equal(r.model, "normal");
  assert.match(r.reason, /files/i);
});

test("a long multi-sentence message escalates to Kanon rather than guessing short", () => {
  const long = "First do this. Then do that. After that, consider the edge cases. Finally, summarize.";
  const r = resolveAutoModel(long);
  assert.equal(r.model, "normal");
});

test("never resolves to a tier CoChat cannot reach", () => {
  const prompts = [
    "hi",
    "write a react component",
    "what's 2+2",
    "translate this to french",
    "tell me a joke",
  ];
  for (const p of prompts) {
    const r = resolveAutoModel(p);
    assert.ok(r.model === "lite" || r.model === "normal", `unexpected tier for "${p}": ${r.model}`);
  }
});
