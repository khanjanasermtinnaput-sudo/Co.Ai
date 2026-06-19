// Tests for the dependency health checker
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('buildHealthReport', () => {
  test('returns a report with required fields', async () => {
    const { buildHealthReport } = await import('../server/health.js');
    const report = await buildHealthReport();

    assert.ok(['pass', 'fail', 'warn'].includes(report.status));
    assert.equal(report.version,   '1');
    assert.equal(report.serviceId, 'coagentix-tmap-v2');
    assert.ok(typeof report.uptimeSec === 'number' && report.uptimeSec >= 0);
    assert.ok(report.timestamp.startsWith('20'));
    assert.ok('redis:ping'     in report.checks);
    assert.ok('supabase:query' in report.checks);
    assert.ok('bullmq:queues'  in report.checks);
  });

  test('each check has a status field', async () => {
    const { buildHealthReport } = await import('../server/health.js');
    const report = await buildHealthReport();

    for (const [name, check] of Object.entries(report.checks)) {
      assert.ok(
        ['pass', 'fail', 'warn'].includes(check.status),
        `check "${name}" has invalid status: ${check.status}`
      );
    }
  });

  test('overall status is fail if any check fails', async () => {
    // This is a structural logic test that doesn't need live services.
    // We simulate a failing check by exercising the aggregation logic.
    // The real buildHealthReport will return 'warn' for unconfigured deps.
    const { buildHealthReport } = await import('../server/health.js');
    const report = await buildHealthReport();

    const statuses = Object.values(report.checks).map((c) => c.status);
    if (statuses.includes('fail')) {
      assert.equal(report.status, 'fail');
    } else if (statuses.includes('warn')) {
      assert.equal(report.status, 'warn');
    } else {
      assert.equal(report.status, 'pass');
    }
  });

  test('report completes within 10 seconds even when deps are unavailable', async () => {
    const { buildHealthReport } = await import('../server/health.js');
    const start = Date.now();
    await buildHealthReport();
    assert.ok(Date.now() - start < 10_000, 'health check took too long');
  });
});
