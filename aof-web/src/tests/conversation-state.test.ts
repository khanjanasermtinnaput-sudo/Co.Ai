import { test } from "node:test";
import assert from "node:assert/strict";
import { isGreeting, containsBuildIntent, classifyTurn } from "../lib/conversation-state.js";

// ── isGreeting ────────────────────────────────────────────────────────────────

test("isGreeting: recognises English greetings", () => {
  assert.equal(isGreeting("hi"), true);
  assert.equal(isGreeting("hello"), true);
  assert.equal(isGreeting("hey"), true);
  assert.equal(isGreeting("yo"), true);
  assert.equal(isGreeting("ok"), true);
  assert.equal(isGreeting("thanks"), true);
  assert.equal(isGreeting("test"), true);
});

test("isGreeting: recognises Thai greetings", () => {
  assert.equal(isGreeting("สวัสดี"), true);
  assert.equal(isGreeting("หวัดดี"), true);
  assert.equal(isGreeting("ไง"), true);
  assert.equal(isGreeting("ดี"), true);
  assert.equal(isGreeting("โอเค"), true);
  assert.equal(isGreeting("ขอบคุณ"), true);
});

test("isGreeting: handles trailing punctuation", () => {
  assert.equal(isGreeting("hi!"), true);
  assert.equal(isGreeting("hey."), true);
  assert.equal(isGreeting("ok?"), true);
});

test("isGreeting: does NOT trigger on messages with project content", () => {
  assert.equal(isGreeting("hi, I want to build an app"), false);
  assert.equal(isGreeting("hello everyone"), false);
  assert.equal(isGreeting("how does Next.js work?"), false);
  assert.equal(isGreeting("build a todo app"), false);
});

// ── containsBuildIntent ───────────────────────────────────────────────────────

test("containsBuildIntent: recognises English build phrases", () => {
  assert.equal(containsBuildIntent("I want to build a website"), true);
  assert.equal(containsBuildIntent("I want to make an app"), true);
  assert.equal(containsBuildIntent("Help me create a game"), true);
  assert.equal(containsBuildIntent("I'm building a SaaS"), true);
  assert.equal(containsBuildIntent("create a REST API for a todo app"), true);
  assert.equal(containsBuildIntent("develop a dashboard for our team"), true);
  assert.equal(containsBuildIntent("I need to build an e-commerce platform"), true);
  assert.equal(containsBuildIntent("I'd like to build a CLI tool"), true);
});

test("containsBuildIntent: recognises Thai build phrases", () => {
  assert.equal(containsBuildIntent("ทำเว็บ"), true);
  assert.equal(containsBuildIntent("ทำแอป"), true);
  assert.equal(containsBuildIntent("สร้างเกม"), true);
  assert.equal(containsBuildIntent("อยากสร้างเว็บ"), true);
  assert.equal(containsBuildIntent("ช่วยทำแอปให้หน่อย"), true);
  assert.equal(containsBuildIntent("ต้องการทำระบบ"), true);
  assert.equal(containsBuildIntent("อยากทำเกม"), true);
});

test("containsBuildIntent: does NOT trigger on greetings", () => {
  assert.equal(containsBuildIntent("hi"), false);
  assert.equal(containsBuildIntent("hello"), false);
  assert.equal(containsBuildIntent("thanks"), false);
  assert.equal(containsBuildIntent("สวัสดี"), false);
  assert.equal(containsBuildIntent("หวัดดี"), false);
});

test("containsBuildIntent: does NOT trigger on tech questions", () => {
  assert.equal(containsBuildIntent("what is Next.js?"), false);
  assert.equal(containsBuildIntent("Next.js vs React — which is better?"), false);
  assert.equal(containsBuildIntent("how do I use useState?"), false);
  assert.equal(containsBuildIntent("explain REST APIs"), false);
});

// ── classifyTurn ──────────────────────────────────────────────────────────────

test("classifyTurn: DEBUGGING when debugMode is true (highest priority)", () => {
  assert.equal(
    classifyTurn({ message: "hi", projectActive: false, debugMode: true }),
    "DEBUGGING",
  );
  assert.equal(
    classifyTurn({ message: "build an app", projectActive: false, debugMode: true }),
    "DEBUGGING",
  );
});

test("classifyTurn: DISCOVERY when projectActive (sticky — beats short message)", () => {
  assert.equal(
    classifyTurn({ message: "ok", projectActive: true, debugMode: false }),
    "DISCOVERY",
  );
  assert.equal(
    classifyTurn({ message: "yes", projectActive: true, debugMode: false }),
    "DISCOVERY",
  );
  assert.equal(
    classifyTurn({ message: "สวัสดี", projectActive: true, debugMode: false }),
    "DISCOVERY",
  );
});

test("classifyTurn: DISCOVERY on build intent (no prior project)", () => {
  assert.equal(
    classifyTurn({ message: "I want to build a website", projectActive: false, debugMode: false }),
    "DISCOVERY",
  );
  assert.equal(
    classifyTurn({ message: "ทำเว็บ", projectActive: false, debugMode: false }),
    "DISCOVERY",
  );
  assert.equal(
    classifyTurn({ message: "Help me create a game", projectActive: false, debugMode: false }),
    "DISCOVERY",
  );
});

test("classifyTurn: NORMAL_CHAT for greetings with no project", () => {
  assert.equal(
    classifyTurn({ message: "hi", projectActive: false, debugMode: false }),
    "NORMAL_CHAT",
  );
  assert.equal(
    classifyTurn({ message: "สวัสดี", projectActive: false, debugMode: false }),
    "NORMAL_CHAT",
  );
  assert.equal(
    classifyTurn({ message: "thanks", projectActive: false, debugMode: false }),
    "NORMAL_CHAT",
  );
});

test("classifyTurn: NORMAL_CHAT for tech questions with no project", () => {
  assert.equal(
    classifyTurn({ message: "what is TypeScript?", projectActive: false, debugMode: false }),
    "NORMAL_CHAT",
  );
  assert.equal(
    classifyTurn({ message: "Next.js vs React?", projectActive: false, debugMode: false }),
    "NORMAL_CHAT",
  );
  assert.equal(
    classifyTurn({ message: "how does useState work?", projectActive: false, debugMode: false }),
    "NORMAL_CHAT",
  );
});

test("classifyTurn: build intent wins over isGreeting check (short build phrase)", () => {
  // "ทำเว็บ" is short but has build intent → DISCOVERY not NORMAL_CHAT
  assert.equal(
    classifyTurn({ message: "ทำเว็บ", projectActive: false, debugMode: false }),
    "DISCOVERY",
  );
});

test("classifyTurn: debugMode beats projectActive", () => {
  assert.equal(
    classifyTurn({ message: "TypeError", projectActive: true, debugMode: true }),
    "DEBUGGING",
  );
});

test("classifyTurn: projectActive beats build intent (already in project)", () => {
  // Both are true — projectActive takes priority (same result: DISCOVERY)
  assert.equal(
    classifyTurn({ message: "add auth to the app", projectActive: true, debugMode: false }),
    "DISCOVERY",
  );
});
