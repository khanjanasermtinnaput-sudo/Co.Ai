// Tests for the aof-web OTel span helpers
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('withSpan', () => {
  test('returns the resolved value of fn', async () => {
    const { withSpan } = await import('../lib/server/telemetry.js');
    const result = await withSpan('test.span', async () => 'hello');
    assert.equal(result, 'hello');
  });

  test('propagates errors thrown inside fn', async () => {
    const { withSpan } = await import('../lib/server/telemetry.js');
    await assert.rejects(
      () => withSpan('failing.span', async () => { throw new Error('oops'); }),
      /oops/,
    );
  });

  test('accepts numeric and boolean attributes', async () => {
    const { withSpan } = await import('../lib/server/telemetry.js');
    const v = await withSpan(
      'attrs.span',
      async () => 99,
      { 'http.status_code': 200, 'cache.hit': true, 'route': '/api/x' },
    );
    assert.equal(v, 99);
  });
});

describe('captureException', () => {
  test('does not throw when SENTRY_DSN is absent', async () => {
    const saved = process.env.NEXT_PUBLIC_SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    const { captureException } = await import('../lib/server/telemetry.js');
    assert.doesNotThrow(() => captureException(new Error('noop')));
    if (saved !== undefined) process.env.NEXT_PUBLIC_SENTRY_DSN = saved;
  });
});

describe('addBreadcrumb', () => {
  test('does not throw when Sentry is not configured', async () => {
    const { addBreadcrumb } = await import('../lib/server/telemetry.js');
    assert.doesNotThrow(() => addBreadcrumb('navigation', { from: '/', to: '/chat' }));
  });
});
