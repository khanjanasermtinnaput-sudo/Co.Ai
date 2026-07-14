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
