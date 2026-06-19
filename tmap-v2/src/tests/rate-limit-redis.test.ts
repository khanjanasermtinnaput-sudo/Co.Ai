import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Only tests the pure header-formatting function — no Redis connection needed.
describe('rateLimitHeaders (tmap-v2)', () => {
  test('returns correct header names and values', async () => {
    const { rateLimitHeaders } = await import('../server/rate-limit-redis.js');
    const result = { allowed: true, limit: 60, remaining: 45, resetAt: 1700000120 };
    const headers = rateLimitHeaders(result);
    assert.equal(headers['X-RateLimit-Limit'], '60');
    assert.equal(headers['X-RateLimit-Remaining'], '45');
    assert.equal(headers['X-RateLimit-Reset'], '1700000120');
  });

  test('RateLimitResult shape is correct', () => {
    const result = { allowed: false, limit: 10, remaining: 0, resetAt: 9999999999 };
    assert.equal(typeof result.allowed, 'boolean');
    assert.equal(typeof result.limit, 'number');
    assert.equal(typeof result.remaining, 'number');
    assert.equal(typeof result.resetAt, 'number');
  });
});
