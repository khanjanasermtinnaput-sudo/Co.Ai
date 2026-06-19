import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasBrief,
  parseBrief,
  summaryToBrief,
  stripBriefBlock,
  briefReadiness,
  briefToTask,
  briefToContext,
  RAA_SYSTEM,
} from "../lib/raa.js";

const FULL = [
  "เข้าใจแล้วครับ สรุป requirement ให้ดังนี้",
  "===REQUIREMENT SUMMARY===",
  "Project: Discord Clone",
  "Task Type: feature",
  "Type: web app",
  "Users: communities and friend groups",
  "Features:",
  "- Authentication",
  "- Text chat",
  "- Friends list",
  "- Voice channels",
  "Confirmed Scope:",
  "- src/app/page.tsx",
  "- src/components/Chat.tsx",
  "Expected Behavior:",
  "- User sends message → appears in channel in real time",
  "- User joins voice → connected to others in the room",
  "Tech Stack: Next.js + WebSocket + PostgreSQL",
  "Architecture: SSR + realtime gateway",
  "Files to Create:",
  "- src/app/page.tsx — main app shell",
  "- src/lib/socket.ts — websocket client",
  "Complexity: Complex",
  "Open Questions:",
  "- None",
  "===END SUMMARY===",
  "✅ พร้อมแล้ว — กดปุ่ม Generate Code หรือพิมพ์ /gencode",
].join("\n");

const CLARIFY = "ก่อนสรุป ขอถามเพิ่ม: 1) เว็บหรือมือถือ? 2) ต้องมี voice ไหม?";

// ── hasBrief ──────────────────────────────────────────────────────────────────

test("hasBrief is true only when both markers are present", () => {
  assert.equal(hasBrief(FULL), true);
  assert.equal(hasBrief(CLARIFY), false);
  assert.equal(hasBrief("===REQUIREMENT SUMMARY=== incomplete"), false);
});

// ── parseBrief ────────────────────────────────────────────────────────────────

test("parseBrief returns null when no summary block is present", () => {
  assert.equal(parseBrief(CLARIFY), null);
});

test("parseBrief extracts single-line fields", () => {
  const b = parseBrief(FULL)!;
  assert.equal(b.project, "Discord Clone");
  assert.equal(b.taskType, "feature");
  assert.equal(b.appType, "web app");
  assert.equal(b.techStack, "Next.js + WebSocket + PostgreSQL");
  assert.equal(b.architecture, "SSR + realtime gateway");
  assert.equal(b.complexity, "Complex");
});

test('parseBrief does not confuse "Type" with "Task Type"', () => {
  const b = parseBrief(FULL)!;
  assert.equal(b.taskType, "feature");
  assert.equal(b.appType, "web app");
});

test("parseBrief extracts multi-item lists and stops at the next header", () => {
  const b = parseBrief(FULL)!;
  assert.deepEqual(b.features, ["Authentication", "Text chat", "Friends list", "Voice channels"]);
  assert.equal(b.scope.length, 2);
  assert.equal(b.expectedBehavior.length, 2);
  assert.ok(b.files.some((f) => f.includes("socket.ts")));
});

test('parseBrief filters "None" out of open questions', () => {
  const b = parseBrief(FULL)!;
  assert.deepEqual(b.openQuestions, []);
});

test("parseBrief keeps real open questions", () => {
  const withQ = FULL.replace("- None", "- ต้องรองรับ mobile ไหม?\n- จำกัดผู้ใช้กี่คน?");
  const b = parseBrief(withQ)!;
  assert.equal(b.openQuestions.length, 2);
  assert.ok(b.openQuestions[0].includes("mobile"));
});

test("parseBrief raw strips the markers", () => {
  const b = parseBrief(FULL)!;
  assert.ok(!b.raw.includes("===REQUIREMENT SUMMARY==="));
  assert.ok(b.raw.startsWith("Project: Discord Clone"));
});

// ── summaryToBrief (live backend shape) ───────────────────────────────────────

test("summaryToBrief maps the backend summary shape", () => {
  const b = summaryToBrief({
    project: "Todo App",
    taskType: "feature",
    type: "web app",
    features: ["add", "delete"],
    scope: [],
    expectedBehavior: [],
    techStack: "React",
    architecture: "SPA",
    files: ["App.tsx"],
    complexity: "Simple",
    openQuestions: ["None"],
    raw: "Project: Todo App",
  });
  assert.equal(b.project, "Todo App");
  assert.equal(b.appType, "web app");
  assert.deepEqual(b.features, ["add", "delete"]);
  assert.deepEqual(b.openQuestions, []); // "None" filtered
});

test("summaryToBrief tolerates missing / wrong-typed fields", () => {
  const b = summaryToBrief({ project: "X" });
  assert.equal(b.project, "X");
  assert.deepEqual(b.features, []);
  assert.equal(b.techStack, "");
});

// ── stripBriefBlock ───────────────────────────────────────────────────────────

test("stripBriefBlock removes the summary block but keeps surrounding text", () => {
  const stripped = stripBriefBlock(FULL);
  assert.ok(!stripped.includes("===REQUIREMENT SUMMARY==="));
  assert.ok(!stripped.includes("Project: Discord Clone"));
  assert.ok(stripped.includes("เข้าใจแล้วครับ"));
  assert.ok(stripped.includes("/gencode"));
});

test("stripBriefBlock leaves a no-summary reply unchanged", () => {
  assert.equal(stripBriefBlock(CLARIFY), CLARIFY);
});

// ── briefReadiness ────────────────────────────────────────────────────────────

test("briefReadiness needs a goal and substance", () => {
  assert.equal(briefReadiness(null), false);
  assert.equal(briefReadiness(parseBrief(FULL)), true);
});

test("briefReadiness is false with a name but no features/scope/behavior", () => {
  const empty = summaryToBrief({ project: "Nameless" });
  assert.equal(briefReadiness(empty), false);
});

test("briefReadiness is true with a goal and at least one feature", () => {
  const b = summaryToBrief({ project: "X", features: ["one thing"] });
  assert.equal(briefReadiness(b), true);
});

// ── briefToTask / briefToContext ──────────────────────────────────────────────

test("briefToTask uses the project name", () => {
  assert.equal(briefToTask(parseBrief(FULL)!), "Discord Clone");
});

test("briefToTask falls back when project is empty", () => {
  assert.equal(briefToTask(summaryToBrief({})), "project from CoAgentix Code brief");
});

test("briefToContext includes stack, features and files", () => {
  const ctx = briefToContext(parseBrief(FULL)!);
  assert.ok(ctx.includes("Approved Project Brief"));
  assert.ok(ctx.includes("Tech Stack: Next.js"));
  assert.ok(ctx.includes("- Authentication"));
  assert.ok(ctx.includes("Files to Create:"));
});

test("briefToContext omits empty sections", () => {
  const ctx = briefToContext(summaryToBrief({ project: "X", features: ["a"] }));
  assert.ok(!ctx.includes("Architecture:"));
  assert.ok(!ctx.includes("Confirmed Scope:"));
});

// ── persona sanity ────────────────────────────────────────────────────────────

test("RAA_SYSTEM forbids code and defines the summary markers", () => {
  assert.ok(/NEVER write code/i.test(RAA_SYSTEM));
  assert.ok(RAA_SYSTEM.includes("===REQUIREMENT SUMMARY==="));
  assert.ok(RAA_SYSTEM.includes("===END SUMMARY==="));
});

// Round-trip: a reply built around the markers parses and is generation-ready.
test("round-trip: parseBrief → briefReadiness → briefToTask", () => {
  const b = parseBrief(FULL)!;
  assert.equal(briefReadiness(b), true);
  assert.equal(briefToTask(b), "Discord Clone");
});
