import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

const REDIS_AVAILABLE = Boolean(process.env.REDIS_URL ?? process.env.REDIS_HOST);

describe('Redis module (unit — no connection needed)', () => {
  test('cacheKey prefixes all parts with cgntx:', async () => {
    const { cacheKey } = await import('../server/redis.js');
    assert.equal(cacheKey('foo', 'bar'), 'cgntx:foo:bar');
    assert.equal(cacheKey('x'),          'cgntx:x');
  });

  test('PubSubChannels builds correct channel names', async () => {
    const { PubSubChannels } = await import('../server/redis.js');
    assert.equal(PubSubChannels.chat('abc123'),  'cgntx:chat:abc123');
    assert.equal(PubSubChannels.tmap('job-1'),   'cgntx:tmap:job-1');
    assert.equal(PubSubChannels.system(),        'cgntx:system');
    assert.equal(PubSubChannels.embed('user-9'), 'cgntx:embed:user-9');
  });
});

describe('Redis integration (requires Redis)', { skip: !REDIS_AVAILABLE }, () => {
  let redis: Awaited<ReturnType<(typeof import('../server/redis.js'))['getRedis']>>;

  after(async () => { try { await redis?.quit(); } catch {} });

  test('ping succeeds', async () => {
    const { getRedis } = await import('../server/redis.js');
    redis = getRedis();
    const reply = await redis.ping();
    assert.equal(reply, 'PONG');
  });

  test('cacheGet returns null for missing key', async () => {
    const { cacheGet } = await import('../server/redis.js');
    const val = await cacheGet<string>('cgntx:missing-key-xyzzy');
    assert.equal(val, null);
  });

  test('cacheSet and cacheGet round-trip', async () => {
    const { cacheSet, cacheGet } = await import('../server/redis.js');
    await cacheSet('cgntx:test:roundtrip', { hello: 'world' }, 10);
    const val = await cacheGet<{ hello: string }>('cgntx:test:roundtrip');
    assert.ok(val !== null);
    assert.equal(val!.hello, 'world');
  });

  test('cacheDel removes key', async () => {
    const { cacheSet, cacheGet, cacheDel } = await import('../server/redis.js');
    await cacheSet('cgntx:test:del', 42, 30);
    await cacheDel('cgntx:test:del');
    const val = await cacheGet('cgntx:test:del');
    assert.equal(val, null);
  });

  test('cacheGetOrSet calls fetcher only once', async () => {
    const { cacheGetOrSet, cacheDel } = await import('../server/redis.js');
    const key = 'cgntx:test:getorset';
    await cacheDel(key);

    let calls = 0;
    const fetcher = async () => { calls++; return { v: 99 }; };

    const r1 = await cacheGetOrSet(key, fetcher, 30);
    const r2 = await cacheGetOrSet(key, fetcher, 30);

    assert.equal(r1.v, 99);
    assert.equal(r2.v, 99);
    assert.equal(calls, 1, 'fetcher should be called only once');
    await cacheDel(key);
  });

  test('publish does not throw when subscriber is absent', async () => {
    const { publish, PubSubChannels } = await import('../server/redis.js');
    await assert.doesNotReject(() => publish(PubSubChannels.system(), { ping: true }));
  });
});
