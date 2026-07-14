// User Memory (Master Prompt Part 6.2, tier 3/4) — pure rendering logic and the
// no-Supabase-configured degrade path. The DB-backed read (loadUserPreferenceMemories
// against a real ai_memory_v2 table) needs a live Supabase project to exercise,
// which this hermetic suite intentionally never contacts — see loadUserPreferenceMemories's
// isAdminConfigured() short-circuit, exercised below.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadUserPreferenceMemories,
  userPreferenceSystemAddon,
  type UserPreferenceMemory,
} from "@/lib/server/memory-context.js";

test("userPreferenceSystemAddon renders nothing for an empty list", () => {
  assert.equal(userPreferenceSystemAddon([]), "");
});

test("userPreferenceSystemAddon frames memories as reference-only, never as instructions", () => {
  const memories: UserPreferenceMemory[] = [
    { key: "response-style", value: "concise", confidence: 0.9 },
    { key: "preferred-language", value: "Thai", confidence: 0.8 },
  ];
  const addon = userPreferenceSystemAddon(memories);
  assert.match(addon, /reference only/i);
  assert.match(addon, /NOT instructions/i);
  assert.match(addon, /response-style/);
  assert.match(addon, /concise/);
  assert.match(addon, /preferred-language/);
});

test("loadUserPreferenceMemories returns [] without a userId (guest turn)", async () => {
  const result = await loadUserPreferenceMemories(undefined);
  assert.deepEqual(result, []);
});

test("loadUserPreferenceMemories returns [] when Supabase admin isn't configured (never throws)", async () => {
  // In this hermetic test env NEXT_PUBLIC_SUPABASE_URL/SERVICE_ROLE_KEY are
  // unset, so isAdminConfigured() is false and the function must short-circuit
  // rather than attempt a real network call.
  const result = await loadUserPreferenceMemories("some-user-id");
  assert.deepEqual(result, []);
});
