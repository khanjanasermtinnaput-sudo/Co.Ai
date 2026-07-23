// Provider Router (Master Prompt Part 6.4) — live health-scored ordering that
// replaced the static routeOrder() chain in /api/chat/route.ts. Each test uses
// a distinct provider id to avoid cross-test health-store state bleed (the
// store is a module-level singleton, same as tmap-v2's dars/health.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyFailureKind,
  configuredProvidersByScore,
  globalProviderHealth,
} from "@/lib/server/provider-router.js";

function withEnv(vars: Record<string, string>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    prev[k] = process.env[k];
    process.env[k] = vars[k];
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("configuredProvidersByScore only returns providers eligible for the task", () => {
  withEnv({ GEMINI_API_KEY: "k", LLAMA_API_KEY: "k" }, () => {
    // 'coding' task's ROUTE_PRIORITY excludes llama (model-registry.ts).
    const order = configuredProvidersByScore("coding").map((p) => p.id);
    assert.ok(order.includes("gemini"));
    assert.ok(!order.includes("llama"), "llama is not in ROUTE_PRIORITY.coding");
  });
});

test("a provider with an auth failure is excluded from the primary pool until cooldown", () => {
  withEnv({ GEMINI_API_KEY: "k", DEEPSEEK_API_KEY: "k" }, () => {
    globalProviderHealth.recordFailure("deepseek", "auth");
    const order = configuredProvidersByScore("coding").map((p) => p.id);
    assert.ok(!order.includes("deepseek"), "circuit-open provider dropped from the primary pool");
    assert.ok(order.includes("gemini"));
  });
});

test("when every eligible provider is circuit-open, the full set is still returned (probe)", () => {
  withEnv({ QWEN_API_KEY: "k" }, () => {
    globalProviderHealth.recordFailure("qwen", "auth");
    // 'chat' ROUTE_PRIORITY includes qwen; with it the only configured provider
    // and circuit-open, the store must still return it rather than an empty list.
    const chatOrder = configuredProvidersByScore("chat").map((p) => p.id);
    assert.ok(chatOrder.includes("qwen"), "last-resort probe still offers the only configured provider");
  });
});

test("recordSuccess closes the circuit again", () => {
  withEnv({ QWEN_API_KEY: "k" }, () => {
    globalProviderHealth.recordFailure("qwen", "rate_limit");
    assert.equal(globalProviderHealth.isAvailable("qwen"), false);
    globalProviderHealth.recordSuccess("qwen", 200);
    assert.equal(globalProviderHealth.isAvailable("qwen"), true);
  });
});

test("classifyFailureKind maps the AOF error taxonomy to DARS-style kinds", () => {
  assert.equal(classifyFailureKind("AOF_ERROR_002"), "auth"); // Invalid API Key
  assert.equal(classifyFailureKind("AOF_ERROR_004"), "quota");
  assert.equal(classifyFailureKind("AOF_ERROR_005"), "rate_limit");
  assert.equal(classifyFailureKind("AOF_ERROR_008"), "timeout");
  assert.equal(classifyFailureKind("AOF_ERROR_011"), "low_quality");
  assert.equal(classifyFailureKind("AOF_ERROR_007"), "down");
});

test("recovery: circuit auto-transitions open -> half_open once the cooldown expires, with no recordSuccess needed", () => {
  const realNow = Date.now;
  try {
    // 3 consecutive "down" fails hits FAIL_THRESHOLD with factor=0 -> BASE_COOLDOWN_MS (30s).
    globalProviderHealth.recordFailure("llama", "down");
    globalProviderHealth.recordFailure("llama", "down");
    globalProviderHealth.recordFailure("llama", "down");
    assert.equal(globalProviderHealth.isAvailable("llama"), false, "circuit opens after 3 consecutive fails");

    const cooldownUntil = globalProviderHealth.get("llama").cooldownUntil!;
    Date.now = () => cooldownUntil - 1;
    assert.equal(globalProviderHealth.isAvailable("llama"), false, "still open 1ms before cooldown expiry");

    Date.now = () => cooldownUntil + 1;
    assert.equal(globalProviderHealth.isAvailable("llama"), true, "auto-recovers to half_open once cooldown has passed");
    assert.equal(globalProviderHealth.get("llama").circuit, "half_open");
  } finally {
    Date.now = realNow;
  }
});

test("boundary: exponential backoff cooldown grows with repeated consecutive fails, capped at factor 4", () => {
  const realNow = Date.now;
  try {
    const fixedNow = 1_700_000_000_000;
    Date.now = () => fixedNow;

    const cooldowns: number[] = [];
    for (let i = 0; i < 7; i++) {
      globalProviderHealth.recordFailure("openrouter", "down");
      const until = globalProviderHealth.get("openrouter").cooldownUntil;
      cooldowns.push(until === undefined ? 0 : until - fixedNow);
    }
    // First 2 fails (below FAIL_THRESHOLD=3) never open the circuit, so cooldownUntil stays unset.
    assert.equal(cooldowns[0], 0, "no cooldown set until FAIL_THRESHOLD consecutive fails");
    assert.equal(cooldowns[1], 0);
    // 3rd fail: factor=0 -> 30s. Each further fail doubles, capped at factor=4 -> 480s.
    assert.equal(cooldowns[2], 30_000);
    assert.equal(cooldowns[3], 60_000);
    assert.equal(cooldowns[4], 120_000);
    assert.equal(cooldowns[5], 240_000);
    assert.equal(cooldowns[6], 480_000, "factor caps at 4 (16x base) even with more consecutive fails");
  } finally {
    Date.now = realNow;
  }
});
