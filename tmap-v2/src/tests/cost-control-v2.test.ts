// P6 — cost control: pre-flight estimation + per-user budget rejection.
// Runs offline against the in-memory Redis mock (NODE_ENV=test).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { estimateCost, estimateTokens } from '../core/cost-budget.js';
import { recordUsage, checkQuota } from '../core/usage-tracker.js';
import type { UsageQuota } from '../types.js';

test('estimateTokens / estimateCost produce sane positive values', () => {
  const t = estimateTokens('a'.repeat(400)); // ~100 tokens
  assert.ok(t >= 90 && t <= 110, `~100 tokens, got ${t}`);
  const cost = estimateCost('default', 1000, 1000);
  assert.ok(cost > 0, 'cost is positive');
  // default rate: (1000*0.5 + 1000*1.5)/1e6 = 0.002
  assert.ok(Math.abs(cost - 0.002) < 1e-9, `expected ~0.002, got ${cost}`);
});

test('checkQuota rejects once the user exceeds their daily token budget', async () => {
  const userId = 'cost-test-' + Math.random().toString(36).slice(2);
  const tightQuota: UsageQuota = {
    dailyTokens: 500, monthlyTokens: 0, dailyCostUsd: 0, monthlyCostUsd: 0, sandboxRunsPerDay: 0,
  };

  // Under budget initially.
  const before = await checkQuota(userId, tightQuota);
  assert.equal(before.ok, true);

  // Consume past the daily token limit.
  await recordUsage(userId, { tokens: 600, costUsd: 0 });

  const after = await checkQuota(userId, tightQuota);
  assert.equal(after.ok, false, 'should reject when over daily token budget');
  assert.match(String(after.reason), /Daily token limit/);
});

test('checkQuota rejects once the user exceeds their daily cost budget', async () => {
  const userId = 'cost-test-' + Math.random().toString(36).slice(2);
  const tightQuota: UsageQuota = {
    dailyTokens: 0, monthlyTokens: 0, dailyCostUsd: 0.01, monthlyCostUsd: 0, sandboxRunsPerDay: 0,
  };
  await recordUsage(userId, { tokens: 0, costUsd: 0.05 });
  const after = await checkQuota(userId, tightQuota);
  assert.equal(after.ok, false);
  assert.match(String(after.reason), /Daily cost limit/);
});
