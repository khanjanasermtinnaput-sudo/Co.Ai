import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getMetrics, incRequest, incError, incTmapRun, addTokens, incAgentCall } from '../server/logger.js';

describe('Metrics', () => {
  test('increments request count', () => {
    const before = getMetrics().requests;
    incRequest();
    assert.equal(getMetrics().requests, before + 1);
  });

  test('increments error count', () => {
    const before = getMetrics().errors;
    incError();
    assert.equal(getMetrics().errors, before + 1);
  });

  test('increments tmap run count', () => {
    const before = getMetrics().tmapRuns;
    incTmapRun();
    assert.equal(getMetrics().tmapRuns, before + 1);
  });

  test('accumulates token usage', () => {
    const before = getMetrics().totalTokens;
    addTokens(500, 0.001);
    assert.equal(getMetrics().totalTokens, before + 500);
  });

  test('tracks agent calls by role and provider', () => {
    incAgentCall('planner', 'Gemini');
    incAgentCall('coder', 'DeepSeek');
    const m = getMetrics();
    assert.ok(m.agentCalls['planner'] > 0);
    assert.ok(m.providerCalls['Gemini'] > 0);
  });

  test('includes uptime', () => {
    const m = getMetrics();
    assert.ok(typeof m.uptimeSec === 'number');
    assert.ok(m.uptimeSec >= 0);
  });
});
