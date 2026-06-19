import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rateLimitHeaders, RateLimitPreset } from '../lib/server/rate-limit-redis';

describe('rateLimitHeaders', () => {
  test('allowed response has correct headers', () => {
    const result = { allowed: true, limit: 100, remaining: 50, resetAt: 1700000060 };
    const headers = rateLimitHeaders(result);
    assert.equal(headers['X-RateLimit-Limit'], '100');
    assert.equal(headers['X-RateLimit-Remaining'], '50');
    assert.equal(headers['X-RateLimit-Reset'], '1700000060');
  });

  test('blocked response has empty Retry-After when allowed', () => {
    const result = { allowed: true, limit: 10, remaining: 0, resetAt: 1700000090 };
    const headers = rateLimitHeaders(result);
    assert.equal(headers['Retry-After'], '');
  });

  test('blocked response has non-empty Retry-After when not allowed', () => {
    const now = Math.ceil(Date.now() / 1000);
    const result = { allowed: false, limit: 10, remaining: 0, resetAt: now + 30 };
    const headers = rateLimitHeaders(result);
    const ra = parseInt(headers['Retry-After'] ?? '0', 10);
    assert.ok(ra > 0 && ra <= 30, `Retry-After should be > 0 and <= 30, got ${ra}`);
  });
});

describe('RateLimitPreset', () => {
  test('auth preset has conservative limit', () => {
    assert.equal(RateLimitPreset.auth.limit, 10);
    assert.equal(RateLimitPreset.auth.windowSec, 60);
  });

  test('chat preset is defined', () => {
    assert.ok(RateLimitPreset.chat.limit > 0);
  });

  test('all presets have positive limit and window', () => {
    for (const [name, preset] of Object.entries(RateLimitPreset)) {
      assert.ok(preset.limit > 0, `${name}.limit should be > 0`);
      assert.ok(preset.windowSec > 0, `${name}.windowSec should be > 0`);
    }
  });
});
