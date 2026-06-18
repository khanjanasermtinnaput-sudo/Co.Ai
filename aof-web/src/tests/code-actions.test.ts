import { test } from "node:test";
import assert from "node:assert/strict";
import { mockPlan, mockAnalyze, mockDebug } from "../lib/mock.js";

// Already-aborted signal skips streaming pacing; the mock still returns full text.
function fast() {
  const ac = new AbortController();
  ac.abort();
  return { onToken: () => {}, signal: ac.signal };
}

test("mockPlan returns a numbered, code-free plan", async () => {
  const text = await mockPlan("a todo web app", fast());
  assert.match(text, /plan/i);
  assert.match(text, /1\./); // numbered steps
  assert.ok(!text.includes("```")); // no code blocks — plan only
});

test("mockAnalyze returns feasibility, risks and recommendations", async () => {
  const text = await mockAnalyze("Project: Discord clone\nStack: Next.js", fast());
  assert.match(text, /Feasibility/i);
  assert.match(text, /Risks/i);
  assert.match(text, /Recommend/i);
});

test("mockDebug diagnoses a root cause before proposing a fix", async () => {
  const text = await mockDebug("TypeError: cannot read property 'x' of undefined", fast());
  assert.match(text, /Root cause/i);
  // root cause appears before the solution — diagnose first, fix second
  assert.ok(text.search(/Root cause/i) < text.search(/Solution|วิธีแก้/i));
});

test("mockDebug echoes the reported error so the diagnosis is grounded", async () => {
  const text = await mockDebug("ReferenceError: foo is not defined", fast());
  assert.match(text, /ReferenceError: foo is not defined/);
});

test("Thai input produces Thai action output", async () => {
  const text = await mockPlan("ทำเว็บ todo", fast());
  assert.ok(/[ก-๙]/.test(text));
});
