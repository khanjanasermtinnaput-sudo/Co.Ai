// Round 2 #3 — atomic, cross-instance quota counters.
//
// Proves the quota store (now Redis HINCRBY/HINCRBYFLOAT) accumulates correctly
// under concurrency and enforces limits — the previous /tmp JSON files were
// per-instance and used read-modify-write, so concurrent requests and multiple
// serverless instances could both race and bypass the limit.
//
// MockRedis (single-process) stands in for Redis here; real Redis provides the
// same atomic semantics across instances.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  recordUsage, recordSandboxRun, checkQuota, checkSandboxQuota, getUsageSummary,
} from '../core/usage-tracker.js';
import type { UsageQuota } from '../types.js';

const uid = () => `qu-${randomUUID().slice(0, 8)}`;
const UNLIMITED: UsageQuota = { dailyTokens: 0, monthlyTokens: 0, dailyCostUsd: 0, monthlyCostUsd: 0, sandboxRunsPerDay: 0 };

describe('Round 2 #3 — atomic quota counters', () => {
  test('100 concurrent recordUsage calls accumulate exactly (no lost updates)', async () => {
    const id = uid();
    await Promise.all(Array.from({ length: 100 }, () => recordUsage(id, { tokens: 10, costUsd: 0.001 })));
    const s = await getUsageSummary(id);
    assert.equal(s.today.tokens, 1000, 'all 100 increments counted');
    assert.equal(s.today.requests, 100);
    assert.ok(Math.abs(s.today.costUsd - 0.1) < 1e-6);
  });

  test('concurrent sandbox runs accumulate exactly', async () => {
    const id = uid();
    await Promise.all(Array.from({ length: 50 }, () => recordSandboxRun(id)));
    const s = await getUsageSummary(id);
    assert.equal(s.today.sandboxRuns, 50);
  });

  test('daily token limit is enforced after recording', async () => {
    const id = uid();
    const quota: UsageQuota = { ...UNLIMITED, dailyTokens: 1000 };
    assert.equal((await checkQuota(id, quota)).ok, true);
    await recordUsage(id, { tokens: 1000, costUsd: 0 });
    const after = await checkQuota(id, quota);
    assert.equal(after.ok, false);
    assert.match(after.reason ?? '', /Daily token limit/);
  });

  test('two independent reads see the same shared counter (cross-instance store)', async () => {
    const id = uid();
    await recordUsage(id, { tokens: 250, costUsd: 0 });
    // Simulate a second "instance" reading: same Redis store, not a per-process file.
    const a = await checkQuota(id, { ...UNLIMITED, dailyTokens: 1_000_000 });
    const b = await getUsageSummary(id);
    assert.equal(a.daily.tokens, 250);
    assert.equal(b.today.tokens, 250);
  });

  test('sandbox quota blocks once the daily run limit is reached', async () => {
    const id = uid();
    const quota: UsageQuota = { ...UNLIMITED, sandboxRunsPerDay: 3 };
    await recordSandboxRun(id); await recordSandboxRun(id); await recordSandboxRun(id);
    const s = await checkSandboxQuota(id, quota);
    assert.equal(s.ok, false);
  });
});
