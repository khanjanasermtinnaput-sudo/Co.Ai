// P1/P2/P12 — RAA v2 is the default router, with confidence scoring, dynamic
// agent selection, a confidence-gated legacy fallback, and routing telemetry.
//
// Runs fully offline (NODE_ENV=test forces mock providers), so it never bills.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runV2 } from '../v2/run.js';
import { globalRoutingTelemetry } from '../v2/routing-telemetry.js';

const baseOpts = { creds: {}, userId: 'test-user-raa' };

test('RAA executes: confidence scoring + dynamic routing produce a plan', async () => {
  process.env.COAGENTIX_RAA_MIN_CONFIDENCE = '0'; // accept any plan → take the RAA path
  globalRoutingTelemetry.reset();

  const r = await runV2('Build a small TODO REST API in Node.js', baseOpts);

  assert.equal(r.route, 'raa-v2', 'should be served by the score-based RAA, not fallback');
  assert.equal(r.fallbackUsed, false);
  assert.equal(typeof r.confidence, 'number');
  assert.ok(r.confidence >= 0 && r.confidence <= 1, 'confidence is a 0..1 score');
  assert.ok(r.output.length > 0, 'produces output');

  const m = globalRoutingTelemetry.metrics();
  assert.equal(m.raaRuns, 1);
  assert.equal(m.fallbackRate, 0);
  assert.equal(m.raaSuccessRate, 1);
  assert.ok(m.recent[0].selected_agents.length >= 1, 'dynamic agent selection recorded ≥1 agent');
});

test('fallback executes: confidence below threshold drops to the legacy route', async () => {
  process.env.COAGENTIX_RAA_MIN_CONFIDENCE = '1.1'; // impossible to meet → always fall back
  globalRoutingTelemetry.reset();

  const r = await runV2('Write a haiku about routing', baseOpts);

  assert.equal(r.route, 'legacy-fallback');
  assert.equal(r.fallbackUsed, true);
  assert.ok(r.output.length > 0, 'fallback still returns an answer (never crashes)');

  const m = globalRoutingTelemetry.metrics();
  assert.equal(m.raaRuns, 1);
  assert.equal(m.fallbackRate, 1);
  assert.equal(m.recent[0].route, 'legacy-fallback');
  assert.match(String(m.recent[0].reason), /threshold/);

  delete process.env.COAGENTIX_RAA_MIN_CONFIDENCE;
});

test('routing telemetry computes success / fallback / avg-confidence', () => {
  globalRoutingTelemetry.reset();
  const now = new Date().toISOString();
  globalRoutingTelemetry.record({ requestId: 'a', route: 'raa-v2', confidence: 0.8, selected_agents: ['coder'], fallback_used: false, ts: now });
  globalRoutingTelemetry.record({ requestId: 'b', route: 'legacy-fallback', confidence: 0.1, selected_agents: [], fallback_used: true, ts: now });

  const m = globalRoutingTelemetry.metrics();
  assert.equal(m.raaRuns, 2);
  assert.equal(m.fallbackRate, 0.5);
  assert.equal(m.raaSuccessRate, 0.5);
  assert.ok(Math.abs(m.avgConfidence - 0.45) < 1e-9);
});
