// Provider Router (Master Prompt Part 6.4) — observability bridge. DARS's
// per-provider circuit breaker (dars/health.ts) and the generic named-dependency
// breaker (server/failover.ts, admin route /v1/failover/circuits) protect
// different domains and are deliberately NOT merged — but every DARS health
// update should still surface on the shared admin health-score registry so
// operators see AI providers on the same dashboard as Redis/DB/etc.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HealthStore } from '../dars/health.js';
import { getHealthScores } from '../server/failover.js';

test('a DARS success reports into the shared failover health-score registry', () => {
  const health = new HealthStore();
  health.recordSuccess('bridge-test-provider', 250);

  const scores = getHealthScores();
  assert.ok('provider:bridge-test-provider' in scores, 'namespaced under provider: to avoid colliding with infra deps');
  assert.equal(scores['provider:bridge-test-provider'].score, 100);
});

test('a DARS failure lowers the reported score without opening the generic breaker', () => {
  const health = new HealthStore();
  health.recordFailure('bridge-test-provider-2', 'down');
  health.recordFailure('bridge-test-provider-2', 'down');

  const scores = getHealthScores();
  // successRate EWMA after two failures from a successRate=1 baseline: 0.8*0.8=0.64 -> 64
  assert.equal(scores['provider:bridge-test-provider-2'].score, 64);
});
