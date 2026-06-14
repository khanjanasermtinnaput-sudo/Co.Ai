import { test } from "node:test";
import assert from "node:assert/strict";
import { mockRequirements } from "../lib/mock.js";
import { parseBrief, briefReadiness, hasBrief } from "../lib/raa.js";

// Drain the mock without waiting on streaming pacing: an already-aborted signal
// makes streamText return immediately, while mockRequirements still returns the
// full reply text it built.
function fast() {
  const ac = new AbortController();
  ac.abort();
  return { onToken: () => {}, signal: ac.signal };
}

test("first vague turn asks clarifying questions and produces no brief", async () => {
  const text = await mockRequirements("build me an app", [], fast());
  assert.equal(hasBrief(text), false);
  assert.equal(parseBrief(text), null);
  assert.match(text, /\?/); // it asks something
});

test("second turn yields a parseable, generation-ready brief", async () => {
  const history = [
    { role: "user" as const, content: "build a discord clone" },
    { role: "assistant" as const, content: "which platform — web, mobile, or desktop?" },
  ];
  const text = await mockRequirements("web, with auth and chat, use Next.js", history, fast());
  assert.equal(hasBrief(text), true);
  const brief = parseBrief(text);
  assert.ok(brief);
  assert.ok(brief!.features.length >= 3);
  assert.equal(briefReadiness(brief), true);
});

test("a detailed first message skips straight to a brief", async () => {
  const detailed =
    "Build a REST API for a todo app in Node.js with auth and a PostgreSQL database, " +
    "supporting CRUD on tasks and JWT login.";
  const text = await mockRequirements(detailed, [], fast());
  assert.equal(hasBrief(text), true);
  const brief = parseBrief(text)!;
  assert.equal(brief.appType, "REST API"); // inferred from "API"
  assert.ok(brief.features.some((f) => /Auth/i.test(f)));
});

test("Thai input produces a Thai-flavoured brief that still parses", async () => {
  const text = await mockRequirements("ทำเว็บแชทเรียลไทม์ มีระบบล็อกอิน ใช้ Next.js", [], fast());
  assert.equal(hasBrief(text), true);
  const brief = parseBrief(text)!;
  assert.ok(brief.project.length > 0);
  assert.equal(briefReadiness(brief), true);
});
