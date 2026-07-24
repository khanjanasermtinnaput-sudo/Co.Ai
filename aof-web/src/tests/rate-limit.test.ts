import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "../lib/server/rate-limit";

// No SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY in the test env, so these all
// exercise the in-memory fallback (memCheck) — same code path local dev uses.

test("image_daily: a 0 override denies immediately (GUEST/no-image-allowance tiers)", async () => {
  const key = `test-zero-${Date.now()}-${Math.random()}`;
  const r = await checkRateLimit(key, "image_daily", 0);
  assert.equal(r.allowed, false);
  assert.equal(r.limit, 0);
  assert.equal(r.remaining, 0);
});

test("image_daily: a positive override (e.g. FREE's 1/day) allows up to the cap, then denies", async () => {
  const key = `test-one-${Date.now()}-${Math.random()}`;
  const first = await checkRateLimit(key, "image_daily", 1);
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 0);

  const second = await checkRateLimit(key, "image_daily", 1);
  assert.equal(second.allowed, false);
});

test("image_daily: separate keys (users) don't share a counter", async () => {
  const keyA = `test-a-${Date.now()}-${Math.random()}`;
  const keyB = `test-b-${Date.now()}-${Math.random()}`;
  await checkRateLimit(keyA, "image_daily", 1);
  const b = await checkRateLimit(keyB, "image_daily", 1);
  assert.equal(b.allowed, true, "a fresh key must not inherit another user's exhausted counter");
});
