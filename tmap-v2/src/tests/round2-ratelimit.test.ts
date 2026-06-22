// Round 2 #2 — rate-limit hardening tests.
//   • Login lockout is now Redis-backed (cross-instance) — verified via MockRedis.
//   • Global limiter fails CLOSED in production when real Redis is configured.
//
// node:test + node:assert/strict only. No REDIS_URL is set, so getRedis() returns
// the in-memory MockRedis — correctness of the counting/lockout logic is what we
// assert here (real Redis enforces the same ops across instances + TTL).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { checkLoginRate, recordFailure, recordSuccess } from '../server/rateLimit.js';
import { shouldFailClosedOnRedisError } from '../server/rate-limit-redis.js';

describe('Round 2 #2 — login lockout (Redis-backed)', () => {
  const ip = '203.0.113.7';
  const freshUser = () => `user-${randomUUID().slice(0, 8)}`;

  test('a fresh account is not blocked and has full attempts', async () => {
    const info = await checkLoginRate(freshUser(), ip);
    assert.equal(info.blocked, false);
    assert.equal(info.remaining, 5);
    assert.equal(info.retryAfterSec, 0);
  });

  test('remaining attempts decrease with each failure', async () => {
    const u = freshUser();
    const a = await recordFailure(u, ip);
    assert.equal(a.remaining, 4);
    const b = await recordFailure(u, ip);
    assert.equal(b.remaining, 3);
  });

  test('5 failures lock the account', async () => {
    const u = freshUser();
    let info;
    for (let i = 0; i < 5; i++) info = await recordFailure(u, ip);
    assert.equal(info!.blocked, true);
    assert.ok(info!.retryAfterSec > 0);

    const check = await checkLoginRate(u, ip);
    assert.equal(check.blocked, true, 'subsequent checks see the lock');
    assert.ok(check.retryAfterSec > 0);
  });

  test('a successful login clears the counter and lock', async () => {
    const u = freshUser();
    for (let i = 0; i < 5; i++) await recordFailure(u, ip);
    assert.equal((await checkLoginRate(u, ip)).blocked, true);

    await recordSuccess(u, ip);
    const after = await checkLoginRate(u, ip);
    assert.equal(after.blocked, false);
    assert.equal(after.remaining, 5);
  });

  test('lockout is keyed by username+IP (different IP is independent)', async () => {
    const u = freshUser();
    for (let i = 0; i < 5; i++) await recordFailure(u, ip);
    assert.equal((await checkLoginRate(u, ip)).blocked, true);
    // same user, different IP → not blocked
    assert.equal((await checkLoginRate(u, '198.51.100.2')).blocked, false);
  });
});

describe('Round 2 #2 — global limiter fail-closed policy', () => {
  test('production + Redis configured → fail closed on Redis error', () => {
    assert.equal(shouldFailClosedOnRedisError({ NODE_ENV: 'production', REDIS_URL: 'redis://x' }), true);
    assert.equal(shouldFailClosedOnRedisError({ VERCEL: '1', REDIS_HOST: 'h' }), true);
  });

  test('dev → degrade to in-memory (do not fail closed)', () => {
    assert.equal(shouldFailClosedOnRedisError({ NODE_ENV: 'development', REDIS_URL: 'redis://x' }), false);
  });

  test('production but no Redis configured → not fail-closed (mock fallback for misconfig)', () => {
    assert.equal(shouldFailClosedOnRedisError({ NODE_ENV: 'production' }), false);
  });
});
