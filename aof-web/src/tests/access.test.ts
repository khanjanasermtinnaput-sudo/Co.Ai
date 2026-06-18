import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAccess } from "../lib/access";
import { GUEST_LIMIT } from "../store/guest-store";

// ── send-message: guest limit ─────────────────────────────────────────────────
test("guest can send below the limit", () => {
  const r = evaluateAccess("send-message", { tier: "GUEST", guestCount: 0 });
  assert.equal(r.allowed, true);
});

test("guest on the last allowed message still passes", () => {
  const r = evaluateAccess("send-message", { tier: "GUEST", guestCount: GUEST_LIMIT - 1 });
  assert.equal(r.allowed, true);
});

test("guest at the limit is blocked and asked to log in", () => {
  const r = evaluateAccess("send-message", { tier: "GUEST", guestCount: GUEST_LIMIT });
  assert.equal(r.allowed, false);
  assert.equal(r.requiresLogin, true);
  assert.equal(r.requiresUpgrade, false);
});

test("signed-in users are never message-limited", () => {
  for (const tier of ["FREE", "LITE", "PRO"] as const) {
    const r = evaluateAccess("send-message", { tier, guestCount: 999 });
    assert.equal(r.allowed, true, `${tier} should not be limited`);
  }
});

// ── create-project / deploy ───────────────────────────────────────────────────
test("guests cannot create projects or deploy", () => {
  for (const action of ["create-project", "deploy"] as const) {
    const r = evaluateAccess(action, { tier: "GUEST", guestCount: 0 });
    assert.equal(r.allowed, false);
    assert.equal(r.requiresLogin, true);
  }
});

test("signed-in users can create projects and deploy", () => {
  for (const action of ["create-project", "deploy"] as const) {
    const r = evaluateAccess(action, { tier: "FREE", guestCount: 0 });
    assert.equal(r.allowed, true);
  }
});

// ── premium-model (Pro / Titan) ───────────────────────────────────────────────
test("guests cannot use premium code modes", () => {
  for (const codeMode of ["pro", "titan"] as const) {
    const r = evaluateAccess("premium-model", { tier: "GUEST", guestCount: 0 }, { codeMode });
    assert.equal(r.allowed, false);
    assert.equal(r.requiresLogin, true);
  }
});

test("guests may use the free code modes", () => {
  for (const codeMode of ["lite", "1.0"] as const) {
    const r = evaluateAccess("premium-model", { tier: "GUEST", guestCount: 0 }, { codeMode });
    assert.equal(r.allowed, true);
  }
});

test("signed-in users may use premium code modes today", () => {
  const r = evaluateAccess("premium-model", { tier: "FREE", guestCount: 0 }, { codeMode: "pro" });
  assert.equal(r.allowed, true);
});
