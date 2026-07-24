// ── security-manager.test.ts ─────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkEgress,
  assessKeyAccessRisk,
  redactForLog,
  auditSecurityEvent,
} from "../lib/server/security-manager";

test("checkEgress allows a real, configured provider host (re-exported from ai-providers.ts)", () => {
  const d = checkEgress("https://api.deepseek.com/v1/chat/completions");
  assert.equal(d.allowed, true);
  assert.equal(d.hostname, "api.deepseek.com");
});

test("checkEgress allows the Z.AI host", () => {
  const d = checkEgress("https://api.z.ai/api/paas/v4/chat/completions");
  assert.equal(d.allowed, true);
  assert.equal(d.hostname, "api.z.ai");
});

test("checkEgress denies api.anthropic.com — Anthropic support was removed", () => {
  const d = checkEgress("https://api.anthropic.com/v1/messages");
  assert.equal(d.allowed, false);
});

test("checkEgress allows loopback — local model providers are not external egress", () => {
  assert.equal(checkEgress("http://localhost:11434/v1/chat/completions").allowed, true);
  assert.equal(checkEgress("http://127.0.0.1:8000/v1/chat/completions").allowed, true);
});

test("checkEgress denies an arbitrary non-provider host — fail closed", () => {
  const d = checkEgress("https://evil.example.com/exfiltrate");
  assert.equal(d.allowed, false);
  assert.equal(d.hostname, "evil.example.com");
  assert.ok(d.reason);
});

test("checkEgress denies a malformed URL rather than throwing", () => {
  const d = checkEgress("not a url");
  assert.equal(d.allowed, false);
  assert.match(d.reason ?? "", /malformed/);
});

test("assessKeyAccessRisk: empty overrides ⇒ low risk (server's own env keys)", () => {
  const r = assessKeyAccessRisk({});
  assert.equal(r.level, "low");
});

test("assessKeyAccessRisk: any per-user key present ⇒ medium risk, real reason named", () => {
  const r = assessKeyAccessRisk({ gemini: "real-key-not-a-fake-one" } as never);
  assert.equal(r.level, "medium");
  assert.match(r.reason, /per-user/);
});

test("redactForLog strips a secret-shaped substring, mirroring errors.ts's redact()", () => {
  const out = redactForLog("Authorization: Bearer sk-ant-abcdef1234567890");
  assert.ok(out);
  assert.ok(!out!.includes("sk-ant-abcdef1234567890"));
  assert.match(out!, /«redacted»/);
});

test("auditSecurityEvent never throws and redacts a secret embedded in its detail", () => {
  const original = console.info;
  let captured = "";
  console.info = (msg: string) => {
    captured = msg;
  };
  try {
    assert.doesNotThrow(() =>
      auditSecurityEvent({
        action: "key-access",
        requestId: "req-test-1",
        userId: "user-1",
        detail: "key=sk-ant-shouldnotleak1234567",
      }),
    );
  } finally {
    console.info = original;
  }
  assert.ok(captured.includes("[SECURITY AUDIT]"));
  assert.ok(captured.includes("req-test-1"));
  assert.ok(!captured.includes("sk-ant-shouldnotleak1234567"));
});
