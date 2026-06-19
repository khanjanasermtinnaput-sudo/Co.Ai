// Tests for telemetry helpers (span wrapping, exception capture)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('withSpan', () => {
  test('returns the value from fn', async () => {
    const { withSpan } = await import('../server/telemetry.js');
    const result = await withSpan('test.span', async (_span) => 42);
    assert.equal(result, 42);
  });

  test('propagates errors thrown inside fn', async () => {
    const { withSpan } = await import('../server/telemetry.js');
    await assert.rejects(
      () => withSpan('error.span', async () => { throw new Error('test error'); }),
      /test error/,
    );
  });

  test('accepts attributes without throwing', async () => {
    const { withSpan } = await import('../server/telemetry.js');
    const result = await withSpan(
      'attr.span',
      async () => 'ok',
      { 'http.method': 'GET', 'http.status_code': 200, 'feature.enabled': true },
    );
    assert.equal(result, 'ok');
  });

  test('captureException is a no-op when SENTRY_DSN is absent', () => {
    // Ensure no DSN is set for this test — captureException should be safe.
    const saved = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    import('../server/telemetry.js').then(({ captureException }) => {
      assert.doesNotThrow(() => captureException(new Error('noop')));
      if (saved !== undefined) process.env.SENTRY_DSN = saved;
    });
  });
});

describe('addBreadcrumb', () => {
  test('does not throw when Sentry is not configured', async () => {
    const { addBreadcrumb } = await import('../server/telemetry.js');
    assert.doesNotThrow(() => addBreadcrumb('test breadcrumb', { key: 'val' }));
  });
});
