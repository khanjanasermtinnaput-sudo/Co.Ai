import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getMetrics, incRequest, incError, incTmapRun, addTokens, incAgentCall, redactLogLine, logger } from '../server/logger.js';

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

// ── Secret redaction (Master Prompt Part 6.10) ────────────────────────────────
describe('redactLogLine', () => {
  test('strips a common key-prefix secret', () => {
    const out = redactLogLine('provider key: sk-ant-abcdef1234567890');
    assert.ok(!out.includes('sk-ant-abcdef1234567890'));
    assert.match(out, /«redacted»/);
  });

  test('strips this package\'s own cgntx_sk_ developer-key prefix', () => {
    const out = redactLogLine('devkey=cgntx_sk_abcdefghijklmnop123456');
    assert.ok(!out.includes('cgntx_sk_abcdefghijklmnop123456'));
  });

  test('strips a Bearer token', () => {
    const out = redactLogLine('Authorization: Bearer abcdef1234567890xyz');
    assert.ok(!out.includes('abcdef1234567890xyz'));
  });

  test('leaves ordinary text untouched', () => {
    const line = '{"msg":"planner completed","tasks":3}';
    assert.equal(redactLogLine(line), line);
  });

  test('logger.info() writing a real secret does not leak it to stdout', () => {
    const original = process.stdout.write.bind(process.stdout);
    let captured = '';
    process.stdout.write = ((chunk: string) => {
      captured += chunk;
      return true;
    }) as typeof process.stdout.write;
    try {
      logger.info('test message', { apiKey: 'sk-or-realkeylooking1234567890' });
    } finally {
      process.stdout.write = original;
    }
    assert.ok(!captured.includes('sk-or-realkeylooking1234567890'));
    assert.ok(captured.includes('«redacted»'));
  });
});
