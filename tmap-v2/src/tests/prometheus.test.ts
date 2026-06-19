// Tests for Prometheus metrics counters and histograms
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('Prometheus metrics', () => {
  test('registry has a content type', async () => {
    const { registry } = await import('../server/prometheus.js');
    assert.match(registry.contentType, /text\/plain|application\/openmetrics-text/);
  });

  test('httpRequestsTotal increments', async () => {
    const { httpRequestsTotal, registry } = await import('../server/prometheus.js');
    httpRequestsTotal.inc({ method: 'GET', route: '/test', status_code: '200' });

    const metrics = await registry.metrics();
    assert.ok(metrics.includes('cgntx_http_requests_total'));
  });

  test('httpRequestDurationMs records an observation', async () => {
    const { httpRequestDurationMs, registry } = await import('../server/prometheus.js');
    httpRequestDurationMs.observe({ method: 'POST', route: '/v1/run' }, 42);

    const metrics = await registry.metrics();
    assert.ok(metrics.includes('cgntx_http_request_duration_ms'));
  });

  test('tmapRunsTotal increments for each mode and status', async () => {
    const { tmapRunsTotal, registry } = await import('../server/prometheus.js');
    tmapRunsTotal.inc({ mode: 'pro',  status: 'success' });
    tmapRunsTotal.inc({ mode: 'lite', status: 'error'   });

    const metrics = await registry.metrics();
    assert.ok(metrics.includes('cgntx_tmap_runs_total'));
  });

  test('tokensTotal tracks by provider and agent_role', async () => {
    const { tokensTotal, registry } = await import('../server/prometheus.js');
    tokensTotal.inc({ provider: 'gemini', agent_role: 'planner' }, 1000);

    const metrics = await registry.metrics();
    assert.ok(metrics.includes('cgntx_tokens_total'));
  });

  test('queueDepth is a gauge and can be set', async () => {
    const { queueDepth, registry } = await import('../server/prometheus.js');
    queueDepth.set({ queue: 'cgntx:embeddings' }, 5);
    queueDepth.set({ queue: 'cgntx:tmap' },        2);

    const metrics = await registry.metrics();
    assert.ok(metrics.includes('cgntx_queue_depth'));
  });

  test('registry output is valid text format (contains # HELP lines)', async () => {
    const { registry } = await import('../server/prometheus.js');
    const metrics = await registry.metrics();
    assert.ok(metrics.includes('# HELP cgntx_http_requests_total'));
    assert.ok(metrics.includes('# TYPE cgntx_http_requests_total counter'));
  });
});

describe('prometheusMiddleware', () => {
  test('exports a function that returns an Express middleware', async () => {
    const { prometheusMiddleware } = await import('../server/prometheus.js');
    const mw = prometheusMiddleware();
    assert.equal(typeof mw, 'function');
    assert.equal(mw.length, 3); // (req, res, next)
  });
});
